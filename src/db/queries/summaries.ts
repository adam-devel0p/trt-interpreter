/**
 * Summaries, narratives and retention state through the RLS-respecting user client (spec
 * FR-20, §6.5, §15.2). Stored rows only — opening a summary, a narrative or the Home slot
 * never calls a model (§19). Generation is a job (`src/summaries/`); the user's part is to
 * read, dismiss, regenerate explicitly and switch surfaces off.
 */
import type { UserClient } from '@/db/client';
import type { InsightKind } from '@/domain/summaries/retention';
import type { StoredHighlights } from '@/domain/summaries/schema';
import type { SummaryKind } from '@/domain/summaries/thresholds';

export class SummaryQueryError extends Error {
  override name = 'SummaryQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
const fail = (what: string, e: { message: string; code?: string }): never => {
  throw new SummaryQueryError(`${what}: ${e.message}`, e.code);
};

export interface SummaryView {
  id: string;
  scope: 'user' | 'journey';
  journey_id: string | null;
  kind: SummaryKind;
  period_start: string;
  period_end: string;
  summary: string;
  highlights: StoredHighlights;
  source_object_ids: string[];
  sources: { type: string; id: string }[];
  object_count: number;
  model_id: string;
  prompt_version: string;
  generated_at: string;
  stale_at: string | null;
  dismissed_at: string | null;
}

const SUMMARY_COLUMNS =
  'id, scope, journey_id, kind, period_start, period_end, summary, highlights, source_object_ids, sources, object_count, model_id, prompt_version, generated_at, stale_at, dismissed_at';

export async function listSummaries(
  client: UserClient,
  opts: { kinds?: SummaryKind[]; includeDismissed?: boolean; limit?: number } = {},
): Promise<SummaryView[]> {
  let q = client
    .from('period_summaries')
    .select(SUMMARY_COLUMNS)
    .is('journey_id', null)
    .order('period_start', { ascending: false })
    .limit(opts.limit ?? 24);
  if (opts.kinds) q = q.in('kind', opts.kinds);
  if (!opts.includeDismissed) q = q.is('dismissed_at', null);
  const { data, error } = await q;
  if (error) fail('summaries read', error);
  return (data ?? []) as unknown as SummaryView[];
}

export async function getSummaryForPeriod(
  client: UserClient,
  kind: SummaryKind,
  periodStart: string,
): Promise<SummaryView | null> {
  const { data, error } = await client
    .from('period_summaries')
    .select(SUMMARY_COLUMNS)
    .eq('kind', kind)
    .eq('period_start', periodStart)
    .is('journey_id', null)
    .maybeSingle();
  if (error) fail('summary read', error);
  return (data as unknown as SummaryView | null) ?? null;
}

export async function getJourneySummary(
  client: UserClient,
  journeyId: string,
): Promise<SummaryView | null> {
  const { data, error } = await client
    .from('period_summaries')
    .select(SUMMARY_COLUMNS)
    .eq('journey_id', journeyId)
    .eq('kind', 'journey')
    .maybeSingle();
  if (error) fail('journey summary read', error);
  return (data as unknown as SummaryView | null) ?? null;
}

export async function getSummary(client: UserClient, id: string): Promise<SummaryView | null> {
  const { data, error } = await client
    .from('period_summaries')
    .select(SUMMARY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) fail('summary read', error);
  return (data as unknown as SummaryView | null) ?? null;
}

/** Dismissal is the user's; it is remembered until they ask for the summary again. */
export async function setSummaryDismissed(
  client: UserClient,
  id: string,
  dismissed: boolean,
): Promise<void> {
  const { error } = await client
    .from('period_summaries')
    .update({ dismissed_at: dismissed ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) fail('summary dismiss', error);
}

export interface NarrativeView {
  id: string;
  journey_id: string;
  sentence: string;
  progression: string[];
  source_object_ids: string[];
  sources: { type: string; id: string }[];
  object_count: number;
  generated_at: string;
  stale_at: string | null;
  model_id: string;
  prompt_version: string;
}

export async function getJourneyNarrative(
  client: UserClient,
  journeyId: string,
): Promise<NarrativeView | null> {
  const { data, error } = await client
    .from('journey_narratives')
    .select(
      'id, journey_id, sentence, progression, source_object_ids, sources, object_count, generated_at, stale_at, model_id, prompt_version',
    )
    .eq('journey_id', journeyId)
    .maybeSingle();
  if (error) fail('narrative read', error);
  return (data as unknown as NarrativeView | null) ?? null;
}

// ── Retention settings and prompts ─────────────────────────────────────────────────────

export const RETENTION_SETTING_KEYS = [
  'on_this_day',
  'unresolved_review',
  'journey_shifts',
  'retrospectives',
] as const;
export type RetentionSettingKey = (typeof RETENTION_SETTING_KEYS)[number];
export type RetentionSettings = Record<RetentionSettingKey, boolean>;

export const RETENTION_DEFAULTS: RetentionSettings = {
  on_this_day: true,
  unresolved_review: true,
  journey_shifts: true,
  retrospectives: true,
};

/** Maps a setting to the Home insight kind it switches. */
export const SETTING_FOR_KIND: Record<InsightKind, RetentionSettingKey> = {
  on_this_day: 'on_this_day',
  unresolved_review: 'unresolved_review',
  journey_shift: 'journey_shifts',
  retrospective: 'retrospectives',
};

export async function getRetentionSettings(client: UserClient): Promise<RetentionSettings> {
  const { data, error } = await client
    .from('reminder_settings')
    .select('on_this_day, unresolved_review, journey_shifts, retrospectives')
    .maybeSingle();
  if (error) fail('retention settings read', error);
  return { ...RETENTION_DEFAULTS, ...((data as Partial<RetentionSettings> | null) ?? {}) };
}

/** One row per user, created on the first change; only the named switch moves. */
export async function setRetentionSetting(
  client: UserClient,
  userId: string,
  key: RetentionSettingKey,
  enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from('reminder_settings')
    .upsert({ user_id: userId, [key]: enabled }, { onConflict: 'user_id' });
  if (error) fail('retention settings write', error);
}

export interface RetentionPromptView {
  id: string;
  kind: InsightKind;
  fingerprint: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown>;
  shown_on: string;
  dismissed_at: string | null;
}

export async function listRetentionPrompts(
  client: UserClient,
  opts: { limit?: number } = {},
): Promise<RetentionPromptView[]> {
  const { data, error } = await client
    .from('retention_prompts')
    .select('id, kind, fingerprint, object_type, object_id, payload, shown_on, dismissed_at')
    .order('shown_on', { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) fail('retention prompts read', error);
  return (data ?? []) as unknown as RetentionPromptView[];
}

/** Records that a surface was shown (idempotent on its fingerprint); returns the row. */
export async function recordPromptShown(
  client: UserClient,
  userId: string,
  prompt: {
    kind: InsightKind;
    fingerprint: string;
    objectType?: string | null;
    objectId?: string | null;
    payload?: Record<string, unknown>;
    shownOn: string;
  },
): Promise<RetentionPromptView> {
  const { data, error } = await client
    .from('retention_prompts')
    .upsert(
      {
        user_id: userId,
        kind: prompt.kind,
        fingerprint: prompt.fingerprint,
        object_type: prompt.objectType ?? null,
        object_id: prompt.objectId ?? null,
        payload: prompt.payload ?? {},
        shown_on: prompt.shownOn,
      },
      { onConflict: 'user_id,kind,fingerprint', ignoreDuplicates: true },
    )
    .select('id, kind, fingerprint, object_type, object_id, payload, shown_on, dismissed_at')
    .maybeSingle();
  if (error) fail('retention prompt write', error);
  if (data) return data as unknown as RetentionPromptView;
  const existing = await client
    .from('retention_prompts')
    .select('id, kind, fingerprint, object_type, object_id, payload, shown_on, dismissed_at')
    .eq('kind', prompt.kind)
    .eq('fingerprint', prompt.fingerprint)
    .single();
  if (existing.error) fail('retention prompt read', existing.error);
  return existing.data as unknown as RetentionPromptView;
}

export async function dismissPrompt(client: UserClient, id: string): Promise<void> {
  const { error } = await client
    .from('retention_prompts')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) fail('retention prompt dismiss', error);
}
