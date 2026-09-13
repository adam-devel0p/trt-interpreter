import 'server-only';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { insertDeletionReceipt, platformDb } from '@/db/admin';
import { readings } from '@/db/schema';
import { DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import { logger } from '@/observability/logger';

/**
 * Hard purge of a soft-deleted reading (docs/PRIVACY_AND_DELETION.md#deletion-flows). Driven by
 * the `reading` root of the deletion registry: every table listed there is counted before the
 * delete, removed (by FK cascade or by an explicit step for `via: 'job'` targets), verified
 * empty afterwards, and written into a `deletion_receipts` row. A table in the registry with
 * no counter here fails the unit test, so the job can never silently fall behind the schema.
 * Service role, by design: the user already said "delete"; nothing here reads content.
 */

export class PurgeError extends Error {
  override readonly name = 'PurgeError';
}

type Counter = (readingId: string) => Promise<number>;
type Remover = (readingId: string) => Promise<void>;

async function countWhere(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await platformDb().execute<{ n: number }>(query);
  return Number(rows[0]?.n ?? 0);
}

/** How many rows each dependent table holds for a reading. Keyed by registry table name. */
export const READING_DEPENDENT_COUNTERS: Record<string, Counter> = {
  reading_cards: (id) =>
    countWhere(sql`select count(*)::int as n from public.reading_cards where reading_id = ${id}`),
  interpretations: (id) =>
    countWhere(sql`select count(*)::int as n from public.interpretations where reading_id = ${id}`),
  question_embeddings: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.question_embeddings where reading_id = ${id}`,
    ),
  safety_flags: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.safety_flags where object_type = 'reading' and object_id = ${id}`,
    ),
  reading_note_revisions: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.reading_note_revisions where reading_id = ${id}`,
    ),
};

/** Explicit steps for registry targets that no FK reaches (`via: 'job'`). */
const READING_JOB_REMOVERS: Record<string, Remover> = {
  safety_flags: async (id) => {
    await platformDb().execute(
      sql`delete from public.safety_flags where object_type = 'reading' and object_id = ${id}`,
    );
  },
};

/** The registry tables this module must know how to count (asserted by a unit test). */
export function readingRegistryTables(): string[] {
  return DELETION_REGISTRY.reading.map((t) => t.table);
}

export interface PurgeResult {
  readingId: string;
  userId: string;
  receiptId: string;
  counts: Record<string, number>;
}

/**
 * Purge one reading. Returns null when nothing is left to purge (already gone). Refuses a
 * reading that was not soft-deleted first: the user-facing delete is the only entry point.
 */
export async function purgeReading(
  readingId: string,
  opts: { jobId?: string } = {},
): Promise<PurgeResult | null> {
  const db = platformDb();
  const [row] = await db
    .select({ id: readings.id, userId: readings.userId, deletedAt: readings.deletedAt })
    .from(readings)
    .where(eq(readings.id, readingId))
    .limit(1);
  if (!row) return null;
  if (!row.deletedAt) throw new PurgeError('reading is not soft-deleted');

  const counts: Record<string, number> = {};
  for (const table of readingRegistryTables()) {
    const counter = READING_DEPENDENT_COUNTERS[table];
    if (!counter) throw new PurgeError(`no counter for registry table ${table}`);
    counts[table] = await counter(readingId);
  }

  await db.transaction(async (tx) => {
    for (const target of DELETION_REGISTRY.reading) {
      if (target.via !== 'job') continue;
      const remover = READING_JOB_REMOVERS[target.table];
      if (!remover) throw new PurgeError(`no remover for job target ${target.table}`);
      await remover(readingId);
    }
    await tx.delete(readings).where(eq(readings.id, readingId));
  });

  // Prove it: nothing dependent may remain.
  for (const table of readingRegistryTables()) {
    const left = await READING_DEPENDENT_COUNTERS[table]!(readingId);
    if (left !== 0) throw new PurgeError(`${table} still holds ${left} row(s) after purge`);
  }
  counts.readings = 1;

  const receipt = await insertDeletionReceipt({
    userId: row.userId,
    scope: 'reading',
    objectType: 'reading',
    objectId: readingId,
    jobId: opts.jobId,
    requestedAt: row.deletedAt,
    counts,
  });
  logger.info('privacy.reading_purged', {
    userId: row.userId,
    objectType: 'reading',
    objectId: readingId,
    jobId: opts.jobId,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  });
  return { readingId, userId: row.userId, receiptId: receipt.id, counts };
}

/** Every soft-deleted reading older than `olderThanMs` (the cron sweep; 0 = all). */
export async function purgeSoftDeletedReadings(
  olderThanMs = 0,
  opts: { jobId?: string; limit?: number } = {},
): Promise<PurgeResult[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await platformDb()
    .select({ id: readings.id })
    .from(readings)
    .where(and(isNotNull(readings.deletedAt), lt(readings.deletedAt, cutoff)))
    .limit(opts.limit ?? 100);
  const out: PurgeResult[] = [];
  for (const r of rows) {
    const res = await purgeReading(r.id, { jobId: opts.jobId });
    if (res) out.push(res);
  }
  return out;
}
