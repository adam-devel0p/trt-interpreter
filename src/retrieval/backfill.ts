import 'server-only';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { profiles, retrievalDocuments } from '@/db/schema';
import { logger } from '@/observability/logger';
import { rebuildRetrievalDocument } from './documents';
import { embedDocument, embedDocumentRows, listStaleDocuments } from './embed';
import { listLiveObjectIds, type HistoryObjectType } from './objects';

/**
 * `embed_object`: rebuild one object's document and embed it when the text changed (or the
 * vector is missing / from another model). `backfill_embeddings`: walk a user's — or every
 * consenting user's — live objects, build what is missing and embed what is stale, bounded
 * per run; the job re-enqueues itself while work remains. Idempotent by construction:
 * unchanged hashes are no-ops.
 */

export interface EmbedObjectResult {
  document: 'built' | 'unchanged' | 'missing' | 'deleted';
  embedding: 'embedded' | 'fresh' | 'skipped_consent' | 'missing' | 'failed' | 'not_applicable';
  errorClass?: string;
}

export async function embedObject(type: HistoryObjectType, id: string): Promise<EmbedObjectResult> {
  const doc = await rebuildRetrievalDocument(type, id);
  if (doc.status === 'missing' || doc.status === 'deleted')
    return { document: doc.status, embedding: 'not_applicable' };
  const emb = await embedDocument(doc.documentId!);
  return { document: doc.status, embedding: emb.status, errorClass: emb.errorClass };
}

export interface BackfillResult {
  usersSeen: number;
  built: number;
  embedded: number;
  failed: number;
  /** True when the run hit its bound and more work remains. */
  more: boolean;
}

async function consentingUserIds(userId: string | null): Promise<string[]> {
  const db = platformDb();
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      userId
        ? and(eq(profiles.id, userId), isNotNull(profiles.aiConsentAt))
        : isNotNull(profiles.aiConsentAt),
    )
    .orderBy(profiles.id);
  return rows.map((r) => r.id);
}

/** Objects of a user with no document yet. */
async function undocumented(userId: string, limit: number) {
  const db = platformDb();
  const all = await listLiveObjectIds(userId);
  const documented = await db
    .select({ objectType: retrievalDocuments.objectType, objectId: retrievalDocuments.objectId })
    .from(retrievalDocuments)
    .where(eq(retrievalDocuments.userId, userId));
  const have = new Set(documented.map((d) => `${d.objectType}:${d.objectId}`));
  return all.filter((o) => !have.has(`${o.type}:${o.id}`)).slice(0, limit);
}

export async function backfillEmbeddings(opts: {
  userId: string | null;
  limit: number;
}): Promise<BackfillResult> {
  const out: BackfillResult = { usersSeen: 0, built: 0, embedded: 0, failed: 0, more: false };
  let budget = opts.limit;
  for (const userId of await consentingUserIds(opts.userId)) {
    if (budget <= 0) {
      out.more = true;
      break;
    }
    out.usersSeen += 1;
    const missing = await undocumented(userId, budget);
    for (const o of missing) {
      const r = await rebuildRetrievalDocument(o.type, o.id);
      if (r.status === 'built') out.built += 1;
      budget -= 1;
    }
    const stale = await listStaleDocuments(userId, Math.max(budget, 0));
    if (stale.length) {
      const r = await embedDocumentRows(userId, stale);
      out.embedded += r.count;
      if (r.status === 'failed') out.failed += stale.length - r.count;
      budget -= stale.length;
    }
    const rows = await platformDb().execute<{ n: number }>(
      sql`select count(*)::int as n from public.retrieval_documents d
          left join public.embeddings e on e.retrieval_document_id = d.id
          where d.user_id = ${userId} and e.id is null`,
    );
    if ((await undocumented(userId, 1)).length > 0 || Number(rows[0]?.n ?? 0) > 0) out.more = true;
  }
  logger.info('retrieval.backfill', {
    count: out.built + out.embedded,
    status: out.more ? 'more' : 'done',
    attempts: out.failed,
  });
  return out;
}
