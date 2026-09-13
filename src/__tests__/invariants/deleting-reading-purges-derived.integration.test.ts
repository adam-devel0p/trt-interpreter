import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import { getInterpretationState } from '@/db/queries/interpretations';
import { searchJournal } from '@/db/queries/journal';
import {
  getReading,
  listReadings,
  softDeleteReading,
  updateReadingNotes,
} from '@/db/queries/readings';
import { listDeletionReceipts } from '@/db/queries/exports';
import { seedReferenceData } from '@/db/seed/reference';
import { EMPTY_FILTERS } from '@/domain/journal/filters';
import { DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import { JOB_HANDLERS } from '@/jobs/handlers';
import { enqueue } from '@/jobs/enqueue';
import { runBatch } from '@/jobs/worker';
import { purgeReading, PurgeError } from '@/privacy/purge';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Invariant 8 / §19 against Postgres: a reading with every kind of derived artifact is
 * soft-deleted (gone from every view at once), then purged by the job — after which no
 * `reading_cards`, `interpretations`, `question_embeddings`, `safety_flags` or
 * `reading_note_revisions` row remains, and a `deletion_receipts` row records the counts for
 * every table in the registry's `reading` root.
 */
async function countRows(table: string, column: string, id: string): Promise<number> {
  const rows = await platformSql()<{ n: string }[]>`
    select count(*)::text as n from ${platformSql()(`public.${table}`)} where ${platformSql()(column)} = ${id}`;
  return Number(rows[0]?.n ?? 0);
}

describe('deleting-reading-purges-derived (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('purge');
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('soft delete hides the reading everywhere; the purge removes every dependent and writes a receipt', async () => {
    const reading = await makeReading(user, refs, { question: 'Purge me?', notes: 'first words' });
    await updateReadingNotes(user.client, reading.id, 'second words');
    await updateReadingNotes(user.client, reading.id, 'third words');
    await attachDerived(user, reading);
    const keep = await makeReading(user, refs, { question: 'Keep me' });
    await attachDerived(user, keep);

    const before = {
      reading_cards: await countRows('reading_cards', 'reading_id', reading.id),
      interpretations: await countRows('interpretations', 'reading_id', reading.id),
      question_embeddings: await countRows('question_embeddings', 'reading_id', reading.id),
      safety_flags: await countRows('safety_flags', 'object_id', reading.id),
      reading_note_revisions: await countRows('reading_note_revisions', 'reading_id', reading.id),
    };
    expect(before).toEqual({
      reading_cards: 3,
      interpretations: 1,
      question_embeddings: 1,
      safety_flags: 1,
      reading_note_revisions: 2,
    });

    // Not soft-deleted yet: the purge refuses. The user's delete is the only entry point.
    await expect(purgeReading(reading.id)).rejects.toBeInstanceOf(PurgeError);

    expect(await softDeleteReading(user.client, reading.id)).toBe(true);
    expect(await getReading(user.client, reading.id)).toBeNull();
    expect((await listReadings(user.client)).map((r) => r.id)).not.toContain(reading.id);
    expect((await searchJournal(user.client, EMPTY_FILTERS)).items.map((i) => i.id)).toEqual([
      keep.id,
    ]);
    expect((await searchJournal(user.client, { ...EMPTY_FILTERS, q: 'purge' })).items).toEqual([]);
    // Derived rows still exist for a moment — and are reachable only by id, never by view.
    expect(await countRows('interpretations', 'reading_id', reading.id)).toBe(1);

    // The job, exactly as the delete action runs it.
    expect(JOB_HANDLERS.has('purge_deleted')).toBe(true);
    const job = await enqueue('purge_deleted', { readingId: reading.id }, { userId: user.id });
    const batch = await runBatch({ jobId: job.id });
    expect(batch).toMatchObject({ claimed: 1, succeeded: 1, dead: 0, retried: 0 });

    for (const table of DELETION_REGISTRY.reading.map((t) => t.table)) {
      const column = table === 'safety_flags' ? 'object_id' : 'reading_id';
      expect(await countRows(table, column, reading.id), `${table} after purge`).toBe(0);
    }
    expect(await countRows('readings', 'id', reading.id)).toBe(0);
    expect((await getInterpretationState(user.client, reading.id)).latest).toBeNull();

    const receipts = await listDeletionReceipts(user.client);
    const receipt = receipts.find((r) => r.object_id === reading.id)!;
    expect(receipt).toBeDefined();
    expect(receipt.scope).toBe('reading');
    expect(receipt.counts).toEqual({ ...before, readings: 1 });
    for (const t of DELETION_REGISTRY.reading.map((t) => t.table)) {
      expect(receipt.counts, `receipt names ${t}`).toHaveProperty(t);
    }
    const jobRow = await platformSql()<{ status: string }[]>`
      select status from jobs where id = ${job.id}`;
    expect(jobRow[0]?.status).toBe('succeeded');

    // The other reading is untouched, derived rows included.
    expect(await countRows('interpretations', 'reading_id', keep.id)).toBe(1);
    expect(await countRows('safety_flags', 'object_id', keep.id)).toBe(1);
    expect(await getReading(user.client, keep.id)).not.toBeNull();

    // Purging again is a no-op (already gone), and the sweep finds nothing.
    expect(await purgeReading(reading.id)).toBeNull();
    const sweep = await enqueue('purge_deleted', { readingId: null }, { userId: user.id });
    expect(await runBatch({ jobId: sweep.id })).toMatchObject({ succeeded: 1 });
  });

  it('the sweep purges soft-deleted readings whose immediate purge never ran', async () => {
    const r = await makeReading(user, refs, { question: 'Sweep me' });
    await attachDerived(user, r);
    await softDeleteReading(user.client, r.id);
    const sweep = await enqueue('purge_deleted', { readingId: null }, { userId: user.id });
    expect(await runBatch({ jobId: sweep.id })).toMatchObject({ succeeded: 1 });
    expect(await countRows('readings', 'id', r.id)).toBe(0);
    expect(await countRows('safety_flags', 'object_id', r.id)).toBe(0);
    expect((await listDeletionReceipts(user.client)).some((x) => x.object_id === r.id)).toBe(true);
  });
});
