import 'server-only';
import { insertDeletionReceipt } from '@/db/admin';
import type { UserClient } from '@/db/client';
import { logger } from '@/observability/logger';

/**
 * "Delete AI artifacts only" (§10 user control, docs/PRIVACY_AND_DELETION.md): removes every
 * model-derived row the user has and keeps every word they wrote — and every correction they
 * made. Runs as the user through RLS (each table has an owner delete policy), so the scope is
 * the caller's rows and nothing else; the receipt is written by the service role.
 *
 * Phase 06 added the structured-memory tables. What goes: extractions, model-sourced theme
 * links, auto/tentative mentions, un-edited predictions and entities the user never
 * confirmed (their aliases and roles cascade). What stays: `metadata_overrides` (the user's
 * corrections — they re-apply on the next extraction), confirmed themes, user-linked
 * mentions, edited predictions, confirmed entities, merge receipts.
 * Phase 07: journeys the user never touched (`user_confirmed = false`) go with their
 * members and progression; `auto` / `pending` members of kept journeys go too (their
 * evidence is being deleted). Accepted, renamed or hand-built journeys stay.
 * Phase 08: `pending` connection suggestions go (with their explanations). Confirmed, maybe
 * and rejected links are the user's decisions — and a rejection is the memory that keeps
 * the same suggestion from coming back — so they stay. Events and outcomes are the user's.
 * Phase 09: embeddings and retrieval documents go (they are rebuilt by the backfill if AI is
 * switched on again); so do `asks` — a question put to the AI and its generated answer are a
 * transcript of the feature, not a journal entry, and the confirmation names them.
 */

export interface AiArtifactTarget {
  table: string;
  /** Column filters narrowing the delete to model-derived rows; `[]` = every own row. */
  where: readonly { column: string; op: 'eq' | 'in'; value: unknown }[];
}

export const AI_ARTIFACT_TARGETS: readonly AiArtifactTarget[] = [
  { table: 'interpretations', where: [] },
  { table: 'safety_flags', where: [] },
  { table: 'question_embeddings', where: [] },
  { table: 'extractions', where: [] },
  { table: 'object_themes', where: [{ column: 'source', op: 'eq', value: 'model' }] },
  {
    table: 'entity_mentions',
    where: [{ column: 'resolution', op: 'in', value: ['auto', 'tentative'] }],
  },
  { table: 'predictions', where: [{ column: 'user_edited', op: 'eq', value: false }] },
  { table: 'entities', where: [{ column: 'user_confirmed', op: 'eq', value: false }] },
  { table: 'journeys', where: [{ column: 'user_confirmed', op: 'eq', value: false }] },
  { table: 'journey_members', where: [{ column: 'state', op: 'in', value: ['auto', 'pending'] }] },
  { table: 'links', where: [{ column: 'state', op: 'eq', value: 'pending' }] },
  // Phase 09: vectors, the compact texts they were made from, and every question put to the
  // AI with its answer. Readings, events, outcomes and decisions are untouched.
  { table: 'embeddings', where: [] },
  { table: 'retrieval_documents', where: [] },
  { table: 'asks', where: [] },
];

export const AI_ARTIFACT_TABLES = [
  'interpretations',
  'safety_flags',
  'question_embeddings',
  'extractions',
  'object_themes',
  'entity_mentions',
  'predictions',
  'entities',
  'journeys',
  'journey_members',
  'links',
  'embeddings',
  'retrieval_documents',
  'asks',
] as const;
export type AiArtifactTable = (typeof AI_ARTIFACT_TABLES)[number];
export type AiArtifactCounts = Record<AiArtifactTable, number>;

/** PostgREST filter builder, typed loosely: the tables are named at runtime by the registry. */
interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, value: unknown[]): Filterable;
}

function applyWhere(q: Filterable, target: AiArtifactTarget): Filterable {
  let out = q;
  for (const w of target.where)
    out = w.op === 'eq' ? out.eq(w.column, w.value) : out.in(w.column, w.value as unknown[]);
  return out;
}

export async function countAiArtifacts(
  client: UserClient,
  userId: string,
): Promise<AiArtifactCounts> {
  const out = {} as AiArtifactCounts;
  for (const target of AI_ARTIFACT_TARGETS) {
    const base = client
      .from(target.table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId) as unknown as Filterable;
    const { count, error } = (await (applyWhere(base, target) as unknown as Promise<{
      count: number | null;
      error: { code?: string } | null;
    }>)) satisfies { count: number | null };
    if (error) throw new Error(`count ${target.table} failed: ${error.code}`);
    out[target.table as AiArtifactTable] = count ?? 0;
  }
  return out;
}

export async function deleteAiArtifacts(
  client: UserClient,
  userId: string,
): Promise<{ receiptId: string; counts: AiArtifactCounts }> {
  const counts = {} as AiArtifactCounts;
  for (const target of AI_ARTIFACT_TARGETS) {
    const base = client.from(target.table).delete().eq('user_id', userId) as unknown as Filterable;
    const scoped = applyWhere(base, target) as unknown as {
      select(
        c: string,
      ): Promise<{ data: { id: string }[] | null; error: { code?: string } | null }>;
    };
    const { data, error } = await scoped.select('id');
    if (error) throw new Error(`delete ${target.table} failed: ${error.code}`);
    counts[target.table as AiArtifactTable] = data?.length ?? 0;
  }
  const receipt = await insertDeletionReceipt({ userId, scope: 'ai_artifacts', counts });
  logger.info('privacy.ai_artifacts_deleted', {
    userId,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  });
  return { receiptId: receipt.id, counts };
}
