import 'server-only';
import type { UserClient } from '@/db/client';
import {
  getRetentionSettings,
  listRetentionPrompts,
  recordPromptShown,
  SETTING_FOR_KIND,
  type RetentionSettings,
} from '@/db/queries/summaries';
import { listActivePeriodStarts } from '@/db/queries/retrospective';
import { detectShift, shiftSentence, type JourneyShift } from '@/domain/journeys/shift';
import type { ProgressionStep } from '@/domain/journeys/progression';
import { meetsSummaryFloor } from '@/domain/summaries/floors';
import { inPeriod, recentCompletePeriods, type Period } from '@/domain/summaries/periods';
import {
  pickInsight,
  pickOnThisDay,
  pickUnresolvedReview,
  type InsightCandidate,
  type InsightKind,
  type Resurfacing,
  type UnresolvedReview,
} from '@/domain/summaries/retention';
import { RESURFACE_MAX_PER_DAY } from '@/domain/summaries/thresholds';
import { logger } from '@/observability/logger';

/**
 * Home's "one relevant retrospective insight" (spec §5, §15.2): the four retention surfaces
 * computed from stored rows as the user, reduced to **one** by priority, subject to the
 * user's switches and remembered dismissals, and recorded in `retention_prompts` so the
 * same thing is not shown again once dismissed, a journey shift is surfaced once, and at
 * most one old reading resurfaces per day. No model call anywhere on this path.
 */

export interface ReadingRef {
  id: string;
  title: string;
  occurredAt: string;
  deck: { name: string; system: 'rws' | 'thoth' } | null;
}

export type HomeInsight =
  | {
      kind: 'journey_shift';
      promptId: string;
      journey: { id: string; title: string };
      sentence: string;
      readings: ReadingRef[];
    }
  | { kind: 'unresolved_review'; promptId: string; subject: string; readings: ReadingRef[] }
  | { kind: 'retrospective'; promptId: string; period: Period; readings: number; events: number }
  | { kind: 'on_this_day'; promptId: string; reading: ReadingRef; yearsAgo: number };

class ReadError extends Error {
  override name = 'RetentionReadError';
}
const fail = (what: string, e: { message: string }): never => {
  throw new ReadError(`${what}: ${e.message}`);
};

type ReadingRow = {
  id: string;
  question: string | null;
  is_open_reflection: boolean;
  occurred_at: string;
  follow_up_status: string;
  decks: { name: string; system: 'rws' | 'thoth' } | null;
};
const titleOf = (r: { question: string | null; is_open_reflection: boolean }) =>
  r.is_open_reflection ? 'Open reflection' : (r.question ?? 'Reading');
const toRef = (r: ReadingRow): ReadingRef => ({
  id: r.id,
  title: titleOf(r),
  occurredAt: r.occurred_at,
  deck: r.decks,
});

async function shiftCandidates(client: UserClient, now: string) {
  const { data, error } = await client
    .from('journey_theme_progression')
    .select(
      'journey_id, sequence_index, period_start, period_end, source_object_ids, themes(slug, label), journeys(id, title, status, merged_into_id, dismissed_at)',
    )
    .order('sequence_index', { ascending: true })
    .limit(1000);
  if (error) fail('progression read', error);
  type Row = {
    journey_id: string;
    sequence_index: number;
    period_start: string;
    period_end: string;
    source_object_ids: string[];
    themes: { slug: string; label: string } | null;
    journeys: {
      id: string;
      title: string;
      status: string;
      merged_into_id: string | null;
      dismissed_at: string | null;
    } | null;
  };
  const byJourney = new Map<string, { title: string; steps: ProgressionStep[] }>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const j = row.journeys;
    if (!j || !row.themes || j.merged_into_id || j.dismissed_at) continue;
    if (j.status !== 'active' && j.status !== 'dormant') continue;
    const cur = byJourney.get(j.id) ?? { title: j.title, steps: [] };
    cur.steps.push({
      sequenceIndex: row.sequence_index,
      slug: row.themes.slug,
      label: row.themes.label,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      sourceObjectIds: row.source_object_ids,
    });
    byJourney.set(j.id, cur);
  }
  const out: InsightCandidate<{ shift: JourneyShift; title: string }>[] = [];
  for (const [id, j] of byJourney) {
    const shift = detectShift(id, j.steps, now);
    if (shift)
      out.push({
        kind: 'journey_shift',
        fingerprint: shift.fingerprint,
        payload: { shift, title: j.title },
      });
  }
  // The most recent shift first.
  out.sort((a, b) => (a.payload.shift.periodStart < b.payload.shift.periodStart ? 1 : -1));
  return out;
}

async function unresolvedCandidate(client: UserClient, readings: ReadingRow[]) {
  const open = readings.filter(
    (r) => r.follow_up_status === 'unresolved' || r.follow_up_status === 'partly_resolved',
  );
  if (open.length < 3) return null;
  const ids = open.map((r) => r.id);
  const [m, t] = await Promise.all([
    client
      .from('entity_mentions')
      .select('object_id, entities(id, canonical_label)')
      .eq('object_type', 'reading')
      .in('object_id', ids)
      .in('resolution', ['auto', 'user']),
    client
      .from('object_themes')
      .select('object_id, weight, themes(slug, label)')
      .eq('object_type', 'reading')
      .in('object_id', ids),
  ]);
  if (m.error) fail('mentions read', m.error);
  if (t.error) fail('themes read', t.error);
  const entities = new Map<string, { id: string; label: string }[]>();
  for (const row of (m.data ?? []) as unknown as {
    object_id: string;
    entities: { id: string; canonical_label: string } | null;
  }[]) {
    if (!row.entities) continue;
    const list = entities.get(row.object_id) ?? [];
    if (!list.some((e) => e.id === row.entities!.id))
      list.push({ id: row.entities.id, label: row.entities.canonical_label });
    entities.set(row.object_id, list);
  }
  const themes = new Map<string, { slug: string; label: string; weight: number }[]>();
  for (const row of (t.data ?? []) as unknown as {
    object_id: string;
    weight: string | number;
    themes: { slug: string; label: string } | null;
  }[]) {
    if (!row.themes) continue;
    const list = themes.get(row.object_id) ?? [];
    list.push({ slug: row.themes.slug, label: row.themes.label, weight: Number(row.weight) });
    themes.set(row.object_id, list);
  }
  const review = pickUnresolvedReview(
    open.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      entities: entities.get(r.id) ?? [],
      themes: (themes.get(r.id) ?? []).sort((a, b) => b.weight - a.weight),
    })),
  );
  if (!review) return null;
  return {
    kind: 'unresolved_review' as const,
    fingerprint: review.fingerprint,
    payload: review,
  } satisfies InsightCandidate<UnresolvedReview>;
}

async function retrospectiveCandidate(client: UserClient, today: string) {
  const active = await listActivePeriodStarts(client);
  const [latest] = recentCompletePeriods('monthly', today, 1);
  if (!latest) return null;
  const readings = active.readings.filter((d) => inPeriod(latest, d)).length;
  const events = active.events.filter((d) => inPeriod(latest, d)).length;
  if (!meetsSummaryFloor('monthly', readings + events)) return null;
  return {
    kind: 'retrospective' as const,
    fingerprint: `retrospective|${latest.key}`,
    payload: { period: latest, readings, events },
  };
}

export async function loadHomeInsight(
  client: UserClient,
  userId: string,
  opts: { now?: Date } = {},
): Promise<{ insight: HomeInsight | null; settings: RetentionSettings }> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const [settings, prompts, r] = await Promise.all([
    getRetentionSettings(client),
    listRetentionPrompts(client),
    client
      .from('readings')
      .select(
        'id, question, is_open_reflection, occurred_at, follow_up_status, decks(name, system)',
      )
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .limit(2000),
  ]);
  if (r.error) fail('readings read', r.error);
  const readings = (r.data ?? []) as unknown as ReadingRow[];
  const dismissed = new Set(prompts.filter((p) => p.dismissed_at).map((p) => p.fingerprint));
  const enabled = Object.fromEntries(
    (Object.keys(SETTING_FOR_KIND) as InsightKind[]).map((k) => [k, settings[SETTING_FOR_KIND[k]]]),
  ) as Record<InsightKind, boolean>;

  const candidates: InsightCandidate[] = [];
  if (enabled.journey_shift) candidates.push(...(await shiftCandidates(client, now.toISOString())));
  if (enabled.unresolved_review) {
    const c = await unresolvedCandidate(client, readings);
    if (c) candidates.push(c);
  }
  if (enabled.retrospective) {
    const c = await retrospectiveCandidate(client, today);
    if (c) candidates.push(c);
  }
  if (enabled.on_this_day) {
    const pick = pickOnThisDay(
      readings.map((x) => ({ id: x.id, occurredAt: x.occurred_at })),
      today,
    );
    // At most one resurfaced reading per calendar day, whatever the pick.
    const shownToday = prompts.filter((p) => p.kind === 'on_this_day' && p.shown_on === today);
    const other = shownToday.some((p) => p.fingerprint !== pick?.fingerprint);
    if (pick && !(other && shownToday.length >= RESURFACE_MAX_PER_DAY))
      candidates.push({ kind: 'on_this_day', fingerprint: pick.fingerprint, payload: pick });
  }

  const chosen = pickInsight(candidates, { enabled, dismissed });
  if (!chosen) return { insight: null, settings };
  const byId = new Map(readings.map((x) => [x.id, x]));
  const refs = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((x): x is ReadingRow => !!x)
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .map(toRef);

  let insight: HomeInsight;
  switch (chosen.kind) {
    case 'journey_shift': {
      const { shift, title } = chosen.payload as { shift: JourneyShift; title: string };
      const prompt = await recordPromptShown(client, userId, {
        kind: 'journey_shift',
        fingerprint: shift.fingerprint,
        objectType: 'journey',
        objectId: shift.journeyId,
        payload: { from: shift.from.slug, to: shift.to.slug, readingIds: shift.sourceObjectIds },
        shownOn: today,
      });
      insight = {
        kind: 'journey_shift',
        promptId: prompt.id,
        journey: { id: shift.journeyId, title },
        sentence: shiftSentence(shift, title),
        readings: refs(shift.sourceObjectIds), // events among the sources are reached through the journey link
      };
      break;
    }
    case 'unresolved_review': {
      const review = chosen.payload as UnresolvedReview;
      const prompt = await recordPromptShown(client, userId, {
        kind: 'unresolved_review',
        fingerprint: review.fingerprint,
        payload: { key: review.key, readingIds: review.readingIds },
        shownOn: today,
      });
      insight = {
        kind: 'unresolved_review',
        promptId: prompt.id,
        subject: review.subject,
        readings: refs(review.readingIds),
      };
      break;
    }
    case 'retrospective': {
      const p = chosen.payload as { period: Period; readings: number; events: number };
      const prompt = await recordPromptShown(client, userId, {
        kind: 'retrospective',
        fingerprint: chosen.fingerprint,
        payload: { period: p.period.key },
        shownOn: today,
      });
      insight = { kind: 'retrospective', promptId: prompt.id, ...p };
      break;
    }
    case 'on_this_day': {
      const pick = chosen.payload as Resurfacing;
      const reading = byId.get(pick.readingId);
      if (!reading) return { insight: null, settings };
      const prompt = await recordPromptShown(client, userId, {
        kind: 'on_this_day',
        fingerprint: pick.fingerprint,
        objectType: 'reading',
        objectId: pick.readingId,
        shownOn: today,
      });
      insight = {
        kind: 'on_this_day',
        promptId: prompt.id,
        reading: toRef(reading),
        yearsAgo: pick.yearsAgo,
      };
      break;
    }
  }
  logger.info('retention.shown', { userId, kind: insight.kind });
  return { insight, settings };
}
