import 'server-only';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { embeddingModelId, getEmbedder } from '@/ai';
import { isProviderError } from '@/ai/provider';
import type { Embedder } from '@/ai/providers/openai-embeddings';
import { platformDb } from '@/db/admin';
import { embeddings, profiles, retrievalDocuments } from '@/db/schema';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * The embedding pipeline (spec §8.3, docs/PRIVACY_AND_DELETION.md). Only the stored
 * `retrieval_documents.text` is ever sent — the request is built from the row, not from the
 * object — and a test asserts the outbound payload equals it byte for byte. Consent-gated:
 * no `ai_consent_at`, no call. Idempotent: a vector at the current model for the current
 * `content_hash` is fresh and nothing is sent; a model change makes every vector stale and
 * the backfill re-embeds. Batched so a backfill costs one call per `EMBED_BATCH` documents.
 */

export const EMBED_BATCH = 16;
/** The embedding request is logged under the document task; the builder itself is deterministic. */
const EMBED_TASK = 'build_retrieval_document' as const;

export type EmbedStatus = 'embedded' | 'fresh' | 'skipped_consent' | 'missing' | 'failed';

export interface EmbedOutcome {
  status: EmbedStatus;
  errorClass?: string;
  /** How many vectors were written (batch calls). */
  count: number;
}

async function hasConsent(userId: string): Promise<boolean> {
  const [row] = await platformDb()
    .select({ consent: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return !!row?.consent;
}

interface DocRow {
  id: string;
  userId: string;
  objectType: string;
  objectId: string;
  text: string;
  contentHash: string;
}

/** Documents of a user whose vector is missing, stale (hash) or from another model. */
export async function listStaleDocuments(userId: string, limit: number): Promise<DocRow[]> {
  const model = embeddingModelId();
  return platformDb()
    .select({
      id: retrievalDocuments.id,
      userId: retrievalDocuments.userId,
      objectType: retrievalDocuments.objectType,
      objectId: retrievalDocuments.objectId,
      text: retrievalDocuments.text,
      contentHash: retrievalDocuments.contentHash,
    })
    .from(retrievalDocuments)
    .leftJoin(embeddings, eq(embeddings.retrievalDocumentId, retrievalDocuments.id))
    .where(
      and(
        eq(retrievalDocuments.userId, userId),
        or(
          isNull(embeddings.id),
          ne(embeddings.contentHash, retrievalDocuments.contentHash),
          ne(embeddings.model, model),
        ),
      ),
    )
    .orderBy(sql`${retrievalDocuments.builtAt} desc`)
    .limit(limit);
}

/**
 * Embed a set of documents of one user in batches. The texts sent are the rows' `text`
 * columns and nothing else. Stale vectors are replaced in the same statement as the insert.
 */
export async function embedDocumentRows(
  userId: string,
  docs: readonly DocRow[],
  embedder: Embedder = getEmbedder(),
): Promise<EmbedOutcome> {
  if (docs.length === 0) return { status: 'fresh', count: 0 };
  if (!(await hasConsent(userId))) return { status: 'skipped_consent', count: 0 };
  const db = platformDb();
  let count = 0;
  for (let i = 0; i < docs.length; i += EMBED_BATCH) {
    const batch = docs.slice(i, i + EMBED_BATCH);
    let result;
    try {
      result = await embedder.embed({
        task: EMBED_TASK,
        texts: batch.map((d) => d.text),
        userId,
        objectRefs: batch.map((d) => ({ type: d.objectType, id: d.objectId })),
      });
    } catch (err) {
      const errorClass = isProviderError(err) ? err.errorClass : errorClassOf(err);
      logger.warn('retrieval.embed_failed', { userId, count: batch.length, errorClass });
      return { status: 'failed', errorClass, count };
    }
    if (result.vectors.length !== batch.length) {
      logger.warn('retrieval.embed_failed', {
        userId,
        count: batch.length,
        errorClass: 'invalid_output',
      });
      return { status: 'failed', errorClass: 'invalid_output', count };
    }
    await db.transaction(async (tx) => {
      await tx.delete(embeddings).where(
        inArray(
          embeddings.retrievalDocumentId,
          batch.map((d) => d.id),
        ),
      );
      await tx.insert(embeddings).values(
        batch.map((d, j) => ({
          userId,
          retrievalDocumentId: d.id,
          objectType: d.objectType,
          objectId: d.objectId,
          vector: result.vectors[j]!,
          model: result.meta.modelId,
          modelVersion: result.meta.modelVersion,
          contentHash: d.contentHash,
        })),
      );
    });
    count += batch.length;
  }
  logger.info('retrieval.embedded', { userId, count });
  return { status: 'embedded', count };
}

/** Embed one document if its vector is missing or stale. */
export async function embedDocument(
  documentId: string,
  embedder?: Embedder,
): Promise<EmbedOutcome> {
  const db = platformDb();
  const [doc] = await db
    .select({
      id: retrievalDocuments.id,
      userId: retrievalDocuments.userId,
      objectType: retrievalDocuments.objectType,
      objectId: retrievalDocuments.objectId,
      text: retrievalDocuments.text,
      contentHash: retrievalDocuments.contentHash,
    })
    .from(retrievalDocuments)
    .where(eq(retrievalDocuments.id, documentId))
    .limit(1);
  if (!doc) return { status: 'missing', count: 0 };
  const [current] = await db
    .select({ contentHash: embeddings.contentHash, model: embeddings.model })
    .from(embeddings)
    .where(eq(embeddings.retrievalDocumentId, documentId))
    .limit(1);
  if (current && current.contentHash === doc.contentHash && current.model === embeddingModelId())
    return { status: 'fresh', count: 0 };
  return embedDocumentRows(doc.userId, [doc], embedder);
}
