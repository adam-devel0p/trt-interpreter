import 'server-only';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { insertDeletionReceipt, platformDb, removeEventMedia } from '@/db/admin';
import { eventMedia, lifeEvents, readings } from '@/db/schema';
import { DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import { journeysOfObjects, journeysOfReadings, refreshJourneys } from '@/journeys/refresh';
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
  // Phase 06: structured memory keyed by (object_type, object_id) or by reading_id.
  extractions: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.extractions where object_type = 'reading' and object_id = ${id}`,
    ),
  metadata_overrides: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.metadata_overrides where object_type = 'reading' and object_id = ${id}`,
    ),
  object_themes: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.object_themes where object_type = 'reading' and object_id = ${id}`,
    ),
  entity_mentions: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.entity_mentions where object_type = 'reading' and object_id = ${id}`,
    ),
  predictions: (id) =>
    countWhere(sql`select count(*)::int as n from public.predictions where reading_id = ${id}`),
  // Phase 07
  journey_members: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.journey_members where object_type = 'reading' and object_id = ${id}`,
    ),
  // Phase 08
  outcomes: (id) =>
    countWhere(sql`select count(*)::int as n from public.outcomes where reading_id = ${id}`),
  links: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.links where (from_type = 'reading' and from_id = ${id}) or (to_type = 'reading' and to_id = ${id})`,
    ),
  // Phase 09
  retrieval_documents: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.retrieval_documents where object_type = 'reading' and object_id = ${id}`,
    ),
  embeddings: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.embeddings where object_type = 'reading' and object_id = ${id}`,
    ),
  asks: (id) => countAskReferences(id),
};

/** Asks that still reference an object anywhere in their citation columns (Phase 09). */
function countAskReferences(id: string): Promise<number> {
  return countWhere(
    sql`select count(*)::int as n from public.asks
        where (coalesce(citations::text, '') || coalesce(claims::text, '') || coalesce(package_object_ids::text, '') || coalesce(dropped_object_ids::text, '')) like ${`%${id}%`}`,
  );
}

/**
 * Scrub every reference to an object out of the asks that cite it (§19): the citation, the
 * claim's citation, the package and dropped lists. The question and the answer text stay —
 * they are the user's ask and a verified answer that names no content of the object.
 */
async function scrubAskReferences(id: string): Promise<void> {
  await platformDb().execute(sql`
    update public.asks set
      citations = case when citations is null then null else
        (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(citations) c where c->>'object_id' <> ${id}) end,
      claims = case when claims is null then null else
        (select coalesce(jsonb_agg(jsonb_set(cl, '{citations}',
            (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(coalesce(cl->'citations', '[]'::jsonb)) x where x->>'object_id' <> ${id}))), '[]'::jsonb)
         from jsonb_array_elements(claims) cl) end,
      package_object_ids = case when package_object_ids is null then null else
        (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(package_object_ids) x where x->>'id' <> ${id}) end,
      dropped_object_ids = case when dropped_object_ids is null then null else
        (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(dropped_object_ids) x where x->>'id' <> ${id}) end
    where (coalesce(citations::text, '') || coalesce(claims::text, '') || coalesce(package_object_ids::text, '') || coalesce(dropped_object_ids::text, '')) like ${`%${id}%`}`);
}

/** Explicit steps for registry targets that no FK reaches (`via: 'job'`). */
const READING_JOB_REMOVERS: Record<string, Remover> = {
  safety_flags: async (id) => {
    await platformDb().execute(
      sql`delete from public.safety_flags where object_type = 'reading' and object_id = ${id}`,
    );
  },
  extractions: async (id) => {
    await platformDb().execute(
      sql`delete from public.extractions where object_type = 'reading' and object_id = ${id}`,
    );
  },
  metadata_overrides: async (id) => {
    await platformDb().execute(
      sql`delete from public.metadata_overrides where object_type = 'reading' and object_id = ${id}`,
    );
  },
  object_themes: async (id) => {
    await platformDb().execute(
      sql`delete from public.object_themes where object_type = 'reading' and object_id = ${id}`,
    );
  },
  entity_mentions: async (id) => {
    await platformDb().execute(
      sql`delete from public.entity_mentions where object_type = 'reading' and object_id = ${id}`,
    );
  },
  journey_members: async (id) => {
    await platformDb().execute(
      sql`delete from public.journey_members where object_type = 'reading' and object_id = ${id}`,
    );
  },
  links: async (id) => {
    await platformDb().execute(
      sql`delete from public.links where (from_type = 'reading' and from_id = ${id}) or (to_type = 'reading' and to_id = ${id})`,
    );
  },
  retrieval_documents: async (id) => {
    await platformDb().execute(
      sql`delete from public.retrieval_documents where object_type = 'reading' and object_id = ${id}`,
    );
  },
  asks: scrubAskReferences,
};

// ── Life events (Phase 08) ─────────────────────────────────────────────────────────────────

const byObject = (table: string) => (id: string) =>
  countWhere(
    sql`select count(*)::int as n from ${sql.raw(`public.${table}`)} where object_type = 'life_event' and object_id = ${id}`,
  );

export const EVENT_DEPENDENT_COUNTERS: Record<string, Counter> = {
  event_media: (id) =>
    countWhere(sql`select count(*)::int as n from public.event_media where life_event_id = ${id}`),
  extractions: byObject('extractions'),
  metadata_overrides: byObject('metadata_overrides'),
  object_themes: byObject('object_themes'),
  entity_mentions: byObject('entity_mentions'),
  journey_members: byObject('journey_members'),
  links: (id) =>
    countWhere(
      sql`select count(*)::int as n from public.links where (from_type = 'life_event' and from_id = ${id}) or (to_type = 'life_event' and to_id = ${id})`,
    ),
  outcomes: (id) =>
    countWhere(sql`select count(*)::int as n from public.outcomes where life_event_id = ${id}`),
  retrieval_documents: byObject('retrieval_documents'),
  embeddings: byObject('embeddings'),
  asks: (id) => countAskReferences(id),
};

const deleteByObject = (table: string) => async (id: string) => {
  await platformDb().execute(
    sql`delete from ${sql.raw(`public.${table}`)} where object_type = 'life_event' and object_id = ${id}`,
  );
};

const EVENT_JOB_REMOVERS: Record<string, Remover> = {
  // Bytes first (the row cascade cannot reach the bucket), then the rows.
  event_media: async (id) => {
    const rows = await platformDb()
      .select({ path: eventMedia.storagePath })
      .from(eventMedia)
      .where(eq(eventMedia.lifeEventId, id));
    await removeEventMedia(rows.map((r) => r.path));
    await platformDb().delete(eventMedia).where(eq(eventMedia.lifeEventId, id));
  },
  extractions: deleteByObject('extractions'),
  metadata_overrides: deleteByObject('metadata_overrides'),
  object_themes: deleteByObject('object_themes'),
  entity_mentions: deleteByObject('entity_mentions'),
  journey_members: deleteByObject('journey_members'),
  links: async (id) => {
    await platformDb().execute(
      sql`delete from public.links where (from_type = 'life_event' and from_id = ${id}) or (to_type = 'life_event' and to_id = ${id})`,
    );
  },
  retrieval_documents: deleteByObject('retrieval_documents'),
  asks: scrubAskReferences,
};

export function eventRegistryTables(): string[] {
  return DELETION_REGISTRY.life_event.map((t) => t.table);
}

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

  // Journeys this reading sat in: refreshed after the delete so every progression step and
  // recurring-symbol claim drops the vanished source (evidence integrity, spec §19).
  const journeyIds = await journeysOfReadings([readingId]);
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
  await refreshJourneys(journeyIds);

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

/** Purge one soft-deleted life event: the same contract as `purgeReading`, driven by the `life_event` root. */
export async function purgeEvent(
  eventId: string,
  opts: { jobId?: string } = {},
): Promise<PurgeResult | null> {
  const db = platformDb();
  const [row] = await db
    .select({ id: lifeEvents.id, userId: lifeEvents.userId, deletedAt: lifeEvents.deletedAt })
    .from(lifeEvents)
    .where(eq(lifeEvents.id, eventId))
    .limit(1);
  if (!row) return null;
  if (!row.deletedAt) throw new PurgeError('life event is not soft-deleted');

  const counts: Record<string, number> = {};
  for (const table of eventRegistryTables()) {
    const counter = EVENT_DEPENDENT_COUNTERS[table];
    if (!counter) throw new PurgeError(`no counter for registry table ${table}`);
    counts[table] = await counter(eventId);
  }
  const journeyIds = await journeysOfObjects('life_event', [eventId]);
  await db.transaction(async (tx) => {
    for (const target of DELETION_REGISTRY.life_event) {
      if (target.via !== 'job') continue;
      const remover = EVENT_JOB_REMOVERS[target.table];
      if (!remover) throw new PurgeError(`no remover for job target ${target.table}`);
      await remover(eventId);
    }
    await tx.delete(lifeEvents).where(eq(lifeEvents.id, eventId));
  });
  for (const table of eventRegistryTables()) {
    const left = await EVENT_DEPENDENT_COUNTERS[table]!(eventId);
    if (left !== 0) throw new PurgeError(`${table} still holds ${left} row(s) after purge`);
  }
  counts.life_events = 1;
  await refreshJourneys(journeyIds);

  const receipt = await insertDeletionReceipt({
    userId: row.userId,
    scope: 'life_event',
    objectType: 'life_event',
    objectId: eventId,
    jobId: opts.jobId,
    requestedAt: row.deletedAt,
    counts,
  });
  logger.info('privacy.event_purged', {
    userId: row.userId,
    objectType: 'life_event',
    objectId: eventId,
    jobId: opts.jobId,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  });
  return { readingId: eventId, userId: row.userId, receiptId: receipt.id, counts };
}

/** Every soft-deleted life event older than `olderThanMs` (the cron sweep; 0 = all). */
export async function purgeSoftDeletedEvents(
  olderThanMs = 0,
  opts: { jobId?: string; limit?: number } = {},
): Promise<PurgeResult[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await platformDb()
    .select({ id: lifeEvents.id })
    .from(lifeEvents)
    .where(and(isNotNull(lifeEvents.deletedAt), lt(lifeEvents.deletedAt, cutoff)))
    .limit(opts.limit ?? 100);
  const out: PurgeResult[] = [];
  for (const r of rows) {
    const res = await purgeEvent(r.id, { jobId: opts.jobId });
    if (res) out.push(res);
  }
  return out;
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
