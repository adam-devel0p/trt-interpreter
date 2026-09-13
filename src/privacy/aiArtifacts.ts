import 'server-only';
import { insertDeletionReceipt } from '@/db/admin';
import type { UserClient } from '@/db/client';
import { logger } from '@/observability/logger';

/**
 * "Delete AI artifacts only" (§10 user control, docs/PRIVACY_AND_DELETION.md): removes every
 * interpretation, safety flag and question embedding the user has, keeps every word they
 * wrote. Runs as the user through RLS (each of these tables has an owner delete policy), so
 * the scope is the caller's rows and nothing else; the receipt is written by the service role.
 */

export const AI_ARTIFACT_TABLES = [
  'interpretations',
  'safety_flags',
  'question_embeddings',
] as const;
export type AiArtifactTable = (typeof AI_ARTIFACT_TABLES)[number];

export async function countAiArtifacts(
  client: UserClient,
  userId: string,
): Promise<Record<AiArtifactTable, number>> {
  const out = {} as Record<AiArtifactTable, number>;
  for (const table of AI_ARTIFACT_TABLES) {
    const { count, error } = await client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw new Error(`count ${table} failed: ${error.code}`);
    out[table] = count ?? 0;
  }
  return out;
}

export async function deleteAiArtifacts(
  client: UserClient,
  userId: string,
): Promise<{ receiptId: string; counts: Record<AiArtifactTable, number> }> {
  const counts = {} as Record<AiArtifactTable, number>;
  for (const table of AI_ARTIFACT_TABLES) {
    const { data, error } = await client.from(table).delete().eq('user_id', userId).select('id');
    if (error) throw new Error(`delete ${table} failed: ${error.code}`);
    counts[table] = data?.length ?? 0;
  }
  const receipt = await insertDeletionReceipt({ userId, scope: 'ai_artifacts', counts });
  logger.info('privacy.ai_artifacts_deleted', {
    userId,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  });
  return { receiptId: receipt.id, counts };
}
