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
    const reading = await makeReading(user, refs, {
      question: 'Should I purge this with Alex?',
      notes: 'first words about my girlfriend in Leeds',
    });
    await updateReadingNotes(user.client, reading.id, 'second words about my girlfriend in Leeds');
    await updateReadingNotes(user.client, reading.id, 'third words about my girlfriend in Leeds');
    const { event } = await attachDerived(user, reading, {
      memory: true,
      journey: true,
      event: true,
    });
    const keep = await makeReading(user, refs, { question: 'Keep me, Alex' });
    await attachDerived(user, keep, { memory: true });
    // Phase 09: a retrieval document with its vector, and an ask that cites the reading.
    const { embedObject } = await import('@/retrieval/backfill');
    expect((await embedObject('reading', reading.id)).embedding).toBe('embedded');
    expect((await embedObject('reading', keep.id)).embedding).toBe('embedded');
    const askRows = await platformSql()<{ id: string }[]>`
      insert into public.asks (user_id, question, scope, status, answer, claims, citations, package_object_ids, dropped_object_ids)
      values (${user.id}, 'Which readings mention Alex?', '{"kind":"all"}'::jsonb, 'complete', 'Two do.',
        ${JSON.stringify([
          {
            text: 'Both.',
            citations: [
              { object_type: 'reading', object_id: reading.id, label: 'E1' },
              { object_type: 'reading', object_id: keep.id, label: 'E2' },
            ],
          },
        ])}::jsonb,
        ${JSON.stringify([
          { object_type: 'reading', object_id: reading.id, label: 'E1' },
          { object_type: 'reading', object_id: keep.id, label: 'E2' },
        ])}::jsonb,
        ${JSON.stringify([
          { type: 'reading', id: reading.id },
          { type: 'reading', id: keep.id },
        ])}::jsonb,
        ${JSON.stringify([{ type: 'reading', id: reading.id }])}::jsonb)
      returning id`;
    const askId = askRows[0]!.id;
    // Phase 10: a summary and a narrative resting on the reading and the kept one, and a
    // prompt pointing at the reading.
    const summaryRows = await platformSql()<{ id: string }[]>`
      insert into public.period_summaries (user_id, scope, kind, period_start, period_end, summary, highlights, source_object_ids, sources, object_count, input_hash, model_id, prompt_version, schema_version)
      values (${user.id}, 'user', 'monthly', '2026-08-01', '2026-08-31', 'A month.',
        ${JSON.stringify({
          recurred: [
            {
              text: 'Both.',
              basis: 'inferred',
              citations: [
                { type: 'reading', id: reading.id },
                { type: 'reading', id: keep.id },
              ],
            },
          ],
          shifted: [
            {
              text: 'Only the purged one.',
              basis: 'inferred',
              citations: [{ type: 'reading', id: reading.id }],
            },
          ],
          open: [],
          confirmed: [],
        })}::jsonb,
        ${[reading.id, keep.id]}::uuid[], ${JSON.stringify([
          { type: 'reading', id: reading.id },
          { type: 'reading', id: keep.id },
        ])}::jsonb,
        5, 'h', 'mock/x', 'p', 's')
      returning id`;
    const summaryId = summaryRows[0]!.id;
    await platformSql()`
      insert into public.retention_prompts (user_id, kind, fingerprint, object_type, object_id)
      values (${user.id}, 'on_this_day', 'fp-purge', 'reading', ${reading.id})`;

    const before = {
      reading_cards: await countRows('reading_cards', 'reading_id', reading.id),
      interpretations: await countRows('interpretations', 'reading_id', reading.id),
      question_embeddings: await countRows('question_embeddings', 'reading_id', reading.id),
      safety_flags: await countRows('safety_flags', 'object_id', reading.id),
      reading_note_revisions: await countRows('reading_note_revisions', 'reading_id', reading.id),
      extractions: await countRows('extractions', 'object_id', reading.id),
      metadata_overrides: await countRows('metadata_overrides', 'object_id', reading.id),
      object_themes: await countRows('object_themes', 'object_id', reading.id),
      entity_mentions: await countRows('entity_mentions', 'object_id', reading.id),
      predictions: await countRows('predictions', 'reading_id', reading.id),
      journey_members: await countRows('journey_members', 'object_id', reading.id),
      outcomes: await countRows('outcomes', 'reading_id', reading.id),
      links: await countRows('links', 'from_id', reading.id),
      retrieval_documents: await countRows('retrieval_documents', 'object_id', reading.id),
      embeddings: await countRows('embeddings', 'object_id', reading.id),
      asks: 1,
      period_summaries: 1,
      journey_narratives: 0,
      retention_prompts: 1,
    };
    expect(before).toMatchObject({
      reading_cards: 3,
      interpretations: 1,
      question_embeddings: 1,
      safety_flags: 1,
      reading_note_revisions: 2,
      extractions: 1,
      metadata_overrides: 1,
      predictions: 1,
    });
    expect(before.object_themes).toBeGreaterThanOrEqual(2);
    expect(before.entity_mentions).toBeGreaterThanOrEqual(2);
    expect(before.journey_members).toBe(1);
    expect(before.outcomes).toBe(1);
    expect(before.links).toBe(1);
    expect(before.retrieval_documents).toBe(1);
    expect(before.embeddings).toBe(1);
    // The entities themselves are the user's memory, not the reading's: they survive the purge.
    const entitiesBefore = await countRows('entities', 'user_id', user.id);

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

    const POLYMORPHIC = new Set([
      'safety_flags',
      'extractions',
      'metadata_overrides',
      'object_themes',
      'entity_mentions',
      'journey_members',
      'retrieval_documents',
      'embeddings',
    ]);
    for (const table of DELETION_REGISTRY.reading.map((t) => t.table)) {
      if (table === 'asks') continue; // scrubbed, not deleted — checked below
      if (table === 'period_summaries' || table === 'journey_narratives') continue; // scrubbed — below
      if (table === 'retention_prompts') {
        expect(await countRows(table, 'object_id', reading.id)).toBe(0);
        continue;
      }
      const column =
        table === 'links' ? 'from_id' : POLYMORPHIC.has(table) ? 'object_id' : 'reading_id';
      expect(await countRows(table, column, reading.id), `${table} after purge`).toBe(0);
    }
    // The ask survives with every reference to the reading scrubbed; the other citation stays.
    const [ask] = await platformSql()<
      {
        answer: string;
        claims: unknown;
        citations: unknown;
        package_object_ids: unknown;
        dropped_object_ids: unknown;
      }[]
    >`
      select answer, claims, citations, package_object_ids, dropped_object_ids from public.asks where id = ${askId}`;
    expect(ask!.answer).toBe('Two do.');
    expect(JSON.stringify(ask)).not.toContain(reading.id);
    expect(ask!.citations).toEqual([{ object_type: 'reading', object_id: keep.id, label: 'E2' }]);
    expect(ask!.claims).toEqual([
      { text: 'Both.', citations: [{ object_type: 'reading', object_id: keep.id, label: 'E2' }] },
    ]);
    expect(ask!.package_object_ids).toEqual([{ type: 'reading', id: keep.id }]);
    expect(ask!.dropped_object_ids).toEqual([]);
    // Phase 10: the summary survives with the reading scrubbed out of its sources and
    // every claim's citations, the claim that rested on it alone gone, and is marked stale.
    const [summary] = await platformSql()<
      {
        source_object_ids: string[];
        sources: unknown;
        highlights: unknown;
        stale_at: string | null;
      }[]
    >`select source_object_ids, sources, highlights, stale_at from public.period_summaries where id = ${summaryId}`;
    expect(summary!.source_object_ids).toEqual([keep.id]);
    expect(JSON.stringify(summary)).not.toContain(reading.id);
    expect(summary!.stale_at).not.toBeNull();
    const h = summary!.highlights as {
      recurred: { citations: { id: string }[] }[];
      shifted: unknown[];
    };
    expect(h.recurred[0]!.citations).toEqual([{ type: 'reading', id: keep.id }]);
    expect(h.shifted).toEqual([]);
    // The life event is the user's own record and stays; its pointer at the reading clears.
    expect(await countRows('life_events', 'id', event!)).toBe(1);
    expect(await countRows('life_events', 'reading_id', reading.id)).toBe(0);
    expect(await countRows('entities', 'user_id', user.id)).toBe(entitiesBefore);
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
    expect(await countRows('embeddings', 'object_id', keep.id)).toBe(1);
    expect(await countRows('extractions', 'object_id', keep.id)).toBe(1);
    expect(await countRows('entity_mentions', 'object_id', keep.id)).toBeGreaterThanOrEqual(1);
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
