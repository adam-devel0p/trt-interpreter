import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { embeddings } from '@/db/schema';

/**
 * Stored vectors by object id, for the model-free engines that take a semantic signal
 * (correlation §3, journey affinity §2). Scoped by `user_id`; an object without a current
 * vector is simply absent, and the engines renormalise the signal out. Read-only.
 */
export async function loadEmbeddingsFor(
  userId: string,
  objectIds: readonly string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (objectIds.length === 0) return out;
  const rows = await platformDb()
    .select({ objectId: embeddings.objectId, vector: embeddings.vector })
    .from(embeddings)
    .where(and(eq(embeddings.userId, userId), inArray(embeddings.objectId, [...objectIds])));
  for (const r of rows)
    if (Array.isArray(r.vector) && r.vector.length) out.set(r.objectId, r.vector);
  return out;
}
