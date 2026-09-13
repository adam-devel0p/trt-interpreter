/**
 * Journeys through the RLS-respecting user client (Phase 07, spec §6.5). Reads for the list,
 * the detail and the reading's membership; writes for every user action — accept, dismiss,
 * rename, close, merge / undo / split, add, keep, remove, undo. Nothing here talks to a
 * model; the detail renders stored rows and derives its sections with pure code
 * (`src/domain/journeys`). Rule-side writes come from `src/journeys/` with the service role.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { clip, JOURNEY_TITLE_MAX } from '@/domain/journeys/titles';
import { ITEM_SELECT, toItem, type JournalItem, type RawItem } from './journal';

export class JourneyQueryError extends Error {
  override name = 'JourneyQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const fail = (what: string, error: { code?: string } | null): never => {
  throw new JourneyQueryError(`${what} failed`, error?.code);
};

export type JourneyStatus = 'suggested' | 'active' | 'dormant' | 'closed';
export type MemberState = 'auto' | 'pending' | 'confirmed' | 'removed';

export interface JourneyRow {
  id: string;
  title: string;
  title_source: 'user' | 'model' | 'rule';
  rationale: string | null;
  status: JourneyStatus;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  confidence: number;
  created_by: 'user' | 'model' | 'rule';
  reasons: string[];
  user_confirmed: boolean;
  accepted_at: string | null;
  dismissed_at: string | null;
  merged_into_id: string | null;
  model_id: string | null;
  named_at: string | null;
  created_at: string;
}

export interface JourneyListItem extends JourneyRow {
  /** Live members (not removed), by type. */
  member_count: number;
  pending_count: number;
}

const JOURNEY_COLUMNS =
  'id, title, title_source, rationale, status, started_at, last_activity_at, ended_at, confidence, ' +
  'created_by, reasons, user_confirmed, accepted_at, dismissed_at, merged_into_id, model_id, named_at, created_at';

function toJourney(raw: Record<string, unknown>): JourneyRow {
  return {
    ...(raw as unknown as JourneyRow),
    confidence: Number(raw.confidence),
    reasons: (raw.reasons as string[] | null) ?? [],
  };
}

/** Every journey that is not merged away, with member counts. Dismissed ones included (flagged). */
export async function listJourneys(client: UserClient): Promise<JourneyListItem[]> {
  const { data, error } = await client
    .from('journeys')
    .select(`${JOURNEY_COLUMNS}, journey_members(state)`)
    .is('merged_into_id', null)
    .order('last_activity_at', { ascending: false });
  if (error) fail('journeys read', error);
  return (
    (data ?? []) as unknown as (Record<string, unknown> & {
      journey_members: { state: MemberState }[];
    })[]
  ).map((raw) => {
    const members = raw.journey_members ?? [];
    return {
      ...toJourney(raw),
      member_count: members.filter((m) => m.state !== 'removed' && m.state !== 'pending').length,
      pending_count: members.filter((m) => m.state === 'pending').length,
    };
  });
}

/** Active first, then suggested (not dismissed), then dormant and closed. */
export function orderForList(items: JourneyListItem[]): {
  active: JourneyListItem[];
  suggested: JourneyListItem[];
  rest: JourneyListItem[];
} {
  const visible = items.filter((j) => !j.dismissed_at);
  return {
    active: visible.filter((j) => j.status === 'active'),
    suggested: visible.filter((j) => j.status === 'suggested'),
    rest: visible.filter((j) => j.status === 'dormant' || j.status === 'closed'),
  };
}

export interface JourneyMemberView {
  id: string;
  state: MemberState;
  confidence: number;
  created_by: 'user' | 'model' | 'rule';
  reasons: string[];
  added_at: string;
  reading: JournalItem & { positions: { key: string; name: string }[] };
  themes: { slug: string; label: string; weight: number }[];
}

export interface ProgressionStepView {
  id: string;
  sequence_index: number;
  theme: { id: string; slug: string; label: string };
  period_start: string;
  period_end: string;
  /** Source objects that are still live members. */
  source_object_ids: string[];
}

export interface JourneyDetail {
  journey: JourneyRow;
  /** Auto + confirmed members whose reading still exists, newest first. */
  members: JourneyMemberView[];
  /** Pending suggestions awaiting the user. */
  pending: JourneyMemberView[];
  progression: ProgressionStepView[];
  /** The journey this one was merged into, if any. */
  merged_into: { id: string; title: string } | null;
}

interface RawMember {
  id: string;
  state: MemberState;
  confidence: string | number;
  created_by: 'user' | 'model' | 'rule';
  reasons: string[] | null;
  added_at: string;
  object_type: string;
  object_id: string;
}

/**
 * One journey with everything its screen shows. A fixed five round trips whatever the member
 * count — journey, members, readings (embedded deck / spread / cards), themes, progression —
 * asserted by the integration test's query counter.
 */
export async function getJourney(client: UserClient, id: string): Promise<JourneyDetail | null> {
  const j = await client.from('journeys').select(JOURNEY_COLUMNS).eq('id', id).maybeSingle();
  if (j.error) fail('journey read', j.error);
  if (!j.data) return null;
  const journey = toJourney(j.data as unknown as Record<string, unknown>);

  const [m, p, into] = await Promise.all([
    client
      .from('journey_members')
      .select('id, state, confidence, created_by, reasons, added_at, object_type, object_id')
      .eq('journey_id', id)
      .neq('state', 'removed')
      .order('added_at', { ascending: true }),
    client
      .from('journey_theme_progression')
      .select(
        'id, sequence_index, period_start, period_end, source_object_ids, themes(id, slug, label)',
      )
      .eq('journey_id', id)
      .order('sequence_index', { ascending: true }),
    journey.merged_into_id
      ? client.from('journeys').select('id, title').eq('id', journey.merged_into_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (m.error) fail('members read', m.error);
  if (p.error) fail('progression read', p.error);
  const memberRows = (m.data ?? []) as unknown as RawMember[];
  const readingIds = memberRows.filter((r) => r.object_type === 'reading').map((r) => r.object_id);

  const [r, t] = readingIds.length
    ? await Promise.all([
        client
          .from('readings')
          .select(
            ITEM_SELECT.replace(
              'spreads(id, name, card_count)',
              'spreads(id, name, card_count, positions)',
            ),
          )
          .in('id', readingIds)
          .is('deleted_at', null),
        client
          .from('object_themes')
          .select('object_id, weight, themes(slug, label)')
          .eq('object_type', 'reading')
          .in('object_id', readingIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (r.error) fail('member readings read', r.error);
  if (t.error) fail('member themes read', t.error);

  type RawReading = RawItem & {
    spreads: RawItem['spreads'] & { positions: { key: string; name: string }[] };
  };
  const readingsById = new Map(
    ((r.data ?? []) as unknown as RawReading[]).map((raw) => [
      raw.id,
      { ...toItem(raw), positions: raw.spreads.positions ?? [] },
    ]),
  );
  const themesByReading = new Map<string, JourneyMemberView['themes']>();
  for (const row of (t.data ?? []) as unknown as {
    object_id: string;
    weight: string | number;
    themes: { slug: string; label: string } | null;
  }[]) {
    if (!row.themes) continue;
    const list = themesByReading.get(row.object_id) ?? [];
    list.push({ slug: row.themes.slug, label: row.themes.label, weight: Number(row.weight) });
    themesByReading.set(row.object_id, list);
  }

  const views: JourneyMemberView[] = [];
  for (const row of memberRows) {
    const reading = readingsById.get(row.object_id);
    if (!reading) continue; // deleted (soft) — out of every view before the purge runs
    views.push({
      id: row.id,
      state: row.state,
      confidence: Number(row.confidence),
      created_by: row.created_by,
      reasons: row.reasons ?? [],
      added_at: row.added_at,
      reading,
      themes: themesByReading.get(row.object_id) ?? [],
    });
  }
  views.sort((a, b) => Date.parse(b.reading.occurred_at) - Date.parse(a.reading.occurred_at));
  const live = new Set(views.filter((v) => v.state !== 'pending').map((v) => v.reading.id));

  const progression: ProgressionStepView[] = (
    (p.data ?? []) as unknown as {
      id: string;
      sequence_index: number;
      period_start: string;
      period_end: string;
      source_object_ids: string[];
      themes: { id: string; slug: string; label: string } | null;
    }[]
  )
    .filter((s) => s.themes)
    .map((s) => ({
      id: s.id,
      sequence_index: s.sequence_index,
      theme: s.themes!,
      period_start: s.period_start,
      period_end: s.period_end,
      source_object_ids: s.source_object_ids.filter((oid) => live.has(oid)),
    }));

  return {
    journey,
    members: views.filter((v) => v.state !== 'pending'),
    pending: views.filter((v) => v.state === 'pending'),
    progression,
    merged_into: (into.data as { id: string; title: string } | null) ?? null,
  };
}

// ── Reading detail ─────────────────────────────────────────────────────────────────────────

export interface ReadingJourneyMembership {
  member_id: string;
  state: Exclude<MemberState, 'removed'>;
  confidence: number;
  reasons: string[];
  journey: { id: string; title: string; status: JourneyStatus; dismissed: boolean };
}

/** The journeys a reading sits in (any live state), plus the ones it could be added to. */
export async function getReadingJourneys(
  client: UserClient,
  readingId: string,
): Promise<{ memberships: ReadingJourneyMembership[]; options: { id: string; title: string }[] }> {
  const [m, j] = await Promise.all([
    client
      .from('journey_members')
      .select(
        'id, state, confidence, reasons, journeys(id, title, status, dismissed_at, merged_into_id)',
      )
      .eq('object_type', 'reading')
      .eq('object_id', readingId)
      .neq('state', 'removed'),
    client
      .from('journeys')
      .select('id, title, status, dismissed_at')
      .is('merged_into_id', null)
      .neq('status', 'closed')
      .order('last_activity_at', { ascending: false }),
  ]);
  if (m.error) fail('reading journeys read', m.error);
  if (j.error) fail('journey options read', j.error);
  const memberships = (
    (m.data ?? []) as unknown as {
      id: string;
      state: MemberState;
      confidence: string | number;
      reasons: string[] | null;
      journeys: {
        id: string;
        title: string;
        status: JourneyStatus;
        dismissed_at: string | null;
        merged_into_id: string | null;
      } | null;
    }[]
  )
    .filter((r) => r.journeys && !r.journeys.merged_into_id && !r.journeys.dismissed_at)
    .map((r) => ({
      member_id: r.id,
      state: r.state as Exclude<MemberState, 'removed'>,
      confidence: Number(r.confidence),
      reasons: r.reasons ?? [],
      journey: {
        id: r.journeys!.id,
        title: r.journeys!.title,
        status: r.journeys!.status,
        dismissed: !!r.journeys!.dismissed_at,
      },
    }));
  const inJourney = new Set(memberships.map((x) => x.journey.id));
  const options = ((j.data ?? []) as { id: string; title: string; dismissed_at: string | null }[])
    .filter((x) => !x.dismissed_at && !inJourney.has(x.id))
    .map((x) => ({ id: x.id, title: x.title }));
  return { memberships, options };
}

// ── Writes (as the user) ───────────────────────────────────────────────────────────────────

export { JOURNEY_TITLE_MAX };
const titleSchema = z.string().trim().min(1).max(JOURNEY_TITLE_MAX);

async function updateJourney(client: UserClient, id: string, patch: Record<string, unknown>) {
  const { data, error } = await client.from('journeys').update(patch).eq('id', id).select('id');
  if (error) fail('journey update', error);
  if (!data?.length) fail('journey update', { code: 'not_found' });
}

/** Accept a suggestion: it becomes active, and the user's say pins it. */
export async function acceptJourney(client: UserClient, id: string): Promise<void> {
  await updateJourney(client, id, {
    status: 'active',
    accepted_at: new Date().toISOString(),
    dismissed_at: null,
    user_confirmed: true,
  });
}

/** Dismiss a suggestion for good: the row stays (hidden) so it is never re-suggested. */
export async function dismissJourney(client: UserClient, id: string): Promise<void> {
  await updateJourney(client, id, { dismissed_at: new Date().toISOString() });
}

/** Rename: the user's title, pinned against the model (`title_source = 'user'`). */
export async function renameJourney(client: UserClient, id: string, title: string): Promise<void> {
  const t = clip(titleSchema.parse(title));
  const { data: row, error } = await client
    .from('journeys')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (error) fail('journey read', error);
  await updateJourney(client, id, {
    title: t,
    title_source: 'user',
    user_confirmed: true,
    ...((row as { status: JourneyStatus } | null)?.status === 'suggested'
      ? { status: 'active', accepted_at: new Date().toISOString() }
      : {}),
  });
}

export async function closeJourney(client: UserClient, id: string): Promise<void> {
  await updateJourney(client, id, {
    status: 'closed',
    ended_at: new Date().toISOString(),
    user_confirmed: true,
  });
}

export async function reopenJourney(client: UserClient, id: string): Promise<void> {
  await updateJourney(client, id, { status: 'active', ended_at: null, user_confirmed: true });
}

/** Delete a journey the user does not want. Members cascade; readings are untouched. */
export async function deleteJourney(client: UserClient, id: string): Promise<void> {
  const { data, error } = await client.from('journeys').delete().eq('id', id).select('id');
  if (error) fail('journey delete', error);
  if (!data?.length) fail('journey delete', { code: 'not_found' });
}

export async function createJourney(
  client: UserClient,
  userId: string,
  title: string,
  readingIds: string[] = [],
): Promise<string> {
  const t = clip(titleSchema.parse(title));
  const { data, error } = await client
    .from('journeys')
    .insert({
      user_id: userId,
      title: t,
      title_source: 'user',
      status: 'active',
      confidence: 1,
      created_by: 'user',
      reasons: ['You created this yourself'],
      user_confirmed: true,
      accepted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) fail('journey create', error);
  const id = (data as { id: string }).id;
  for (const readingId of readingIds) await addReadingToJourney(client, userId, id, readingId);
  return id;
}

export async function addReadingToJourney(
  client: UserClient,
  userId: string,
  journeyId: string,
  readingId: string,
): Promise<void> {
  const { error } = await client.from('journey_members').upsert(
    {
      user_id: userId,
      journey_id: journeyId,
      object_type: 'reading',
      object_id: readingId,
      confidence: 1,
      created_by: 'user',
      state: 'confirmed',
      signals: null,
      reasons: ['You added this yourself'],
    },
    { onConflict: 'journey_id,object_type,object_id' },
  );
  if (error) fail('member add', error);
  await updateJourney(client, journeyId, { user_confirmed: true });
}

async function setMemberState(
  client: UserClient,
  memberId: string,
  state: MemberState,
): Promise<{ journeyId: string; previous: MemberState }> {
  const { data: before, error: readErr } = await client
    .from('journey_members')
    .select('journey_id, state')
    .eq('id', memberId)
    .maybeSingle();
  if (readErr) fail('member read', readErr);
  if (!before) fail('member read', { code: 'not_found' });
  const row = before as { journey_id: string; state: MemberState };
  const { error } = await client
    .from('journey_members')
    .update({ state, ...(state === 'confirmed' ? { created_by: 'user' } : {}) })
    .eq('id', memberId);
  if (error) fail('member update', error);
  await updateJourney(client, row.journey_id, { user_confirmed: true });
  return { journeyId: row.journey_id, previous: row.state };
}

/** Keep (auto → confirmed) or accept (pending → confirmed). */
export async function confirmMember(client: UserClient, memberId: string) {
  return setMemberState(client, memberId, 'confirmed');
}

/** Remove or decline: the row stays as `removed` so the rule never re-adds it. */
export async function removeMember(client: UserClient, memberId: string) {
  return setMemberState(client, memberId, 'removed');
}

/** Undo a removal: back to the state it had (auto / pending / confirmed). */
export async function restoreMember(client: UserClient, memberId: string, to: MemberState) {
  const state = z.enum(['auto', 'pending', 'confirmed']).parse(to);
  return setMemberState(client, memberId, state);
}

export async function mergeJourneys(client: UserClient, sourceId: string, targetId: string) {
  const { error } = await client.rpc('apply_journey_merge', {
    p_source: sourceId,
    p_target: targetId,
  });
  if (error) fail('journey merge', error);
}

export async function undoJourneyMerge(client: UserClient, sourceId: string) {
  const { error } = await client.rpc('undo_journey_merge', { p_source: sourceId });
  if (error) fail('journey merge undo', error);
}

export async function splitJourney(
  client: UserClient,
  sourceId: string,
  title: string,
  memberIds: string[],
): Promise<string> {
  const t = clip(titleSchema.parse(title));
  const { data, error } = await client.rpc('apply_journey_split', {
    p_source: sourceId,
    p_title: t,
    p_member_ids: memberIds,
  });
  if (error) fail('journey split', error);
  return data as string;
}

/** Journeys merged into this one that can still be undone. */
export async function listMergedInto(client: UserClient, targetId: string) {
  const { data, error } = await client
    .from('journeys')
    .select('id, title, ended_at')
    .eq('merged_into_id', targetId);
  if (error) fail('merged journeys read', error);
  return (data ?? []) as { id: string; title: string; ended_at: string | null }[];
}

/** The single suggestion Home shows (newest, not dismissed). */
export async function nextSuggestedJourney(client: UserClient): Promise<JourneyListItem | null> {
  const all = await listJourneys(client);
  return orderForList(all).suggested[0] ?? null;
}
