import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as summarizeTask from '@/ai/tasks/summarize_period';
import { platformDb } from '@/db/admin';
import { journeys, periodSummaries, profiles } from '@/db/schema';
import { meetsSummaryFloor } from '@/domain/summaries/floors';
import { periodLabel, type Period } from '@/domain/summaries/periods';
import {
  summaryCitedLabels,
  validateSources,
  verifySummary,
  type SourceRef,
} from '@/domain/summaries/provenance';
import {
  SUMMARY_SECTIONS,
  type PeriodSummary,
  type StoredHighlights,
} from '@/domain/summaries/schema';
import type { SummaryKind } from '@/domain/summaries/thresholds';
import { flagForUser } from '@/flags/server';
import { logger } from '@/observability/logger';
import { loadJourneyEvidence, loadPeriodEvidence, type SummaryEvidence } from './evidence';
import { storeSummaryDocument } from './retrieval';

/**
 * Period summaries (spec FR-20, §9.2, §19): one generation per (user, kind, period[,
 * journey]). Reached from the `summarize_period` job, the sweep, the seed and the explicit
 * "regenerate" action — never from a view. Gates, in order: the row's owner has consented
 * and is on the `period_summaries` flag; the period holds enough live objects (the data
 * floor — otherwise nothing is generated *and nothing is shown*); the evidence changed since
 * the stored row (`input_hash`) unless `force`. The model output is verified against the
 * package: unknown labels stripped, uncited and unsupported-fact claims dropped, one repair
 * turn, then — if nothing grounded survives — nothing is stored. Stored claims carry their
 * citations as object ids, so the screen can link every sentence to its entries.
 */

export type GenerateOutcome =
  | {
      status: 'skipped';
      reason: 'consent' | 'flag' | 'floor' | 'unchanged' | 'missing' | 'ungrounded' | 'dismissed';
      objectCount?: number;
    }
  | { status: 'generated'; summaryId: string; claims: number; repaired: boolean }
  | { status: 'failed'; errorClass: string; retryable: boolean };

const RETRYABLE = new Set(['timeout', 'provider_error']);

export interface GenerateArgs {
  userId: string;
  kind: SummaryKind;
  /** Period bounds; for `journey` the journey's own span is used and this is ignored. */
  period?: Pick<Period, 'start' | 'end'>;
  journeyId?: string;
  /** Regenerate even when the evidence hash is unchanged (the explicit user action). */
  force?: boolean;
  /** Regenerate a dismissed summary (the explicit user action only). */
  includeDismissed?: boolean;
  runner?: AiRunner;
  now?: Date;
}

function toStored(
  summary: PeriodSummary,
  byLabel: ReadonlyMap<string, SourceRef>,
): StoredHighlights {
  const out = {} as StoredHighlights;
  for (const s of SUMMARY_SECTIONS)
    out[s] = summary[s].map((c) => ({
      text: c.text,
      basis: c.basis,
      citations: c.citations.map((l) => byLabel.get(l)!).filter(Boolean),
    }));
  return out;
}

async function gates(userId: string): Promise<'consent' | 'flag' | null> {
  const [profile] = await platformDb()
    .select({ consent: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!profile?.consent) return 'consent';
  if (!(await flagForUser('period_summaries', userId))) return 'flag';
  return null;
}

export async function generatePeriodSummary(args: GenerateArgs): Promise<GenerateOutcome> {
  const db = platformDb();
  const now = args.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const gate = await gates(args.userId);
  if (gate) return { status: 'skipped', reason: gate };

  let evidence: SummaryEvidence;
  let period: Pick<Period, 'start' | 'end'>;
  let label: string;
  let scope: 'user' | 'journey' = 'user';
  if (args.kind === 'journey') {
    if (!args.journeyId) return { status: 'skipped', reason: 'missing' };
    const [j] = await db
      .select({ id: journeys.id, title: journeys.title, userId: journeys.userId })
      .from(journeys)
      .where(and(eq(journeys.id, args.journeyId), eq(journeys.userId, args.userId)))
      .limit(1);
    if (!j) return { status: 'skipped', reason: 'missing' };
    const loaded = await loadJourneyEvidence(j.id);
    if (!loaded) return { status: 'skipped', reason: 'missing' };
    evidence = loaded.evidence;
    const dates = evidence.package.objects.map((o) => o.date).sort();
    period = { start: dates[0] ?? today, end: dates[dates.length - 1] ?? today };
    label = `the journey “${j.title}”`;
    scope = 'journey';
  } else {
    if (!args.period) return { status: 'skipped', reason: 'missing' };
    period = args.period;
    evidence = await loadPeriodEvidence(args.userId, period);
    label = periodLabel({ kind: args.kind, start: period.start });
  }
  if (!meetsSummaryFloor(args.kind, evidence.objectCount))
    return { status: 'skipped', reason: 'floor', objectCount: evidence.objectCount };

  const journeyKey = args.journeyId ?? null;
  const [existing] = await db
    .select({
      id: periodSummaries.id,
      inputHash: periodSummaries.inputHash,
      dismissedAt: periodSummaries.dismissedAt,
      promptVersion: periodSummaries.promptVersion,
    })
    .from(periodSummaries)
    .where(
      and(
        eq(periodSummaries.userId, args.userId),
        eq(periodSummaries.kind, args.kind),
        eq(periodSummaries.periodStart, period.start),
        journeyKey ? eq(periodSummaries.journeyId, journeyKey) : isNull(periodSummaries.journeyId),
      ),
    )
    .limit(1);
  if (existing?.dismissedAt && !args.includeDismissed)
    return { status: 'skipped', reason: 'dismissed' };
  if (
    existing &&
    !args.force &&
    existing.inputHash === evidence.inputHash &&
    existing.promptVersion === summarizeTask.PROMPT_VERSION
  )
    return { status: 'skipped', reason: 'unchanged' };

  const sources = validateSources(evidence.sources);
  if (!sources.ok) return { status: 'skipped', reason: 'floor', objectCount: evidence.objectCount };

  const runner = args.runner ?? getAiRunner();
  const objectRefs = [
    ...(args.journeyId ? [{ type: 'journey', id: args.journeyId }] : []),
    ...evidence.sources,
    ...evidence.package.droppedIds.map((d) => ({ type: `dropped_${d.type}`, id: d.id })),
  ];
  const input: summarizeTask.SummarizePeriodInput = {
    periodLabel: label,
    kind: args.kind,
    start: period.start,
    end: period.end,
    today,
    counts: evidence.counts,
    journeys: evidence.journeys,
    evidence: evidence.rendered,
    droppedCount: evidence.droppedCount,
  };
  const request = summarizeTask.buildSummarizePeriodRequest(input, {
    userId: args.userId,
    objectRefs,
    mockObjects: evidence.mockObjects,
  });
  const first = await runner.runObject(request);
  if (!first.ok) {
    logger.warn('summaries.generate_failed', {
      userId: args.userId,
      errorClass: first.errorClass,
      status: first.status,
    });
    return {
      status: 'failed',
      errorClass: first.errorClass,
      retryable: RETRYABLE.has(first.status),
    };
  }
  let verified = verifySummary(first.value, evidence.labels);
  let modelId = first.meta.modelId;
  let repaired = false;
  if (!verified.grounded || verified.stripped.length || verified.dropped.length) {
    logger.info('summaries.verify', {
      userId: args.userId,
      status: verified.grounded ? 'stripped' : 'regenerate',
      count: verified.stripped.length + verified.dropped.length,
    });
    if (!verified.grounded) {
      const second = await runner.runObject({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: JSON.stringify(first.value) },
          { role: 'user', content: summarizeTask.repairHint(verified.issues, verified.stripped) },
        ],
      });
      if (second.ok) {
        const again = verifySummary(second.value, evidence.labels);
        if (again.grounded) {
          verified = again;
          modelId = second.meta.modelId;
          repaired = true;
        }
      }
    }
  }
  if (!verified.grounded) {
    logger.info('summaries.ungrounded', { userId: args.userId, kind: args.kind });
    return { status: 'skipped', reason: 'ungrounded' };
  }

  // Sources stored: what the model saw; the claims cite a subset of them.
  const cited = new Set(summaryCitedLabels(verified.summary));
  const citedSources = evidence.sources.filter((s) =>
    [...cited].some((l) => evidence.byLabel.get(l)?.id === s.id),
  );
  const row = {
    userId: args.userId,
    scope,
    journeyId: journeyKey,
    kind: args.kind,
    periodStart: period.start,
    periodEnd: period.end,
    summary: verified.summary.headline,
    highlights: toStored(verified.summary, evidence.byLabel),
    sourceObjectIds: (citedSources.length ? citedSources : evidence.sources).map((s) => s.id),
    sources: citedSources.length ? citedSources : evidence.sources,
    objectCount: evidence.objectCount,
    inputHash: evidence.inputHash,
    modelId,
    promptVersion: summarizeTask.PROMPT_VERSION,
    schemaVersion: summarizeTask.SCHEMA_VERSION,
    generatedAt: now,
    staleAt: null,
    dismissedAt: null,
    updatedAt: now,
  };
  const [stored] = existing
    ? await db
        .update(periodSummaries)
        .set(row)
        .where(eq(periodSummaries.id, existing.id))
        .returning({ id: periodSummaries.id })
    : await db.insert(periodSummaries).values(row).returning({ id: periodSummaries.id });
  const summaryId = stored!.id;
  const claims = SUMMARY_SECTIONS.reduce((n, s) => n + verified.summary[s].length, 0);
  await storeSummaryDocument(summaryId);
  logger.info('summaries.generated', {
    userId: args.userId,
    kind: args.kind,
    summaryId,
    count: claims,
    modelId,
  });
  return { status: 'generated', summaryId, claims, repaired };
}

/** Marks a stored summary stale (a source changed under it); the screen offers regeneration. */
export async function markSummariesStaleForObjects(objectIds: readonly string[]): Promise<number> {
  if (objectIds.length === 0) return 0;
  const rows = await platformDb()
    .update(periodSummaries)
    .set({ staleAt: sql`coalesce(${periodSummaries.staleAt}, now())` })
    .where(
      sql`${periodSummaries.sourceObjectIds} && ${sql.raw(`array[${objectIds.map((id) => `'${id}'::uuid`).join(',')}]`)}`,
    )
    .returning({ id: periodSummaries.id });
  return rows.length;
}
