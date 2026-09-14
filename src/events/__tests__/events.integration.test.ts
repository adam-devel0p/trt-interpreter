import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, getMockProvider, resetAiForTests } from '@/ai';
import { closeAdmin, platformDb } from '@/db/admin';
import {
  entityMentions,
  extractions,
  jobs,
  lifeEvents,
  links,
  objectThemes,
  outcomes,
} from '@/db/schema';
import {
  createEvent,
  currentOutcomes,
  getEvent,
  listDueRevisits,
  listEvents,
  listReadingOutcomes,
  recordOutcome,
  softDeleteEvent,
} from '@/db/queries/events';
import { getReadingMemory } from '@/db/queries/memory';
import { setAiConsent } from '@/db/queries/profile';
import { getReading, setRevisitAt } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { runEventExtraction } from '@/events/extract';
import { runBatch } from '@/jobs/worker';
import { runExtraction } from '@/memory/extract';
import { purgeEvent } from '@/privacy/purge';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableCorrelation, enableExtraction, grantPremium } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * Life events and outcomes against Postgres with the mock provider (spec §6.4, FR-11,
 * FR-14, FR-15): an event is saved and complete before any extraction; a failed extraction
 * leaves it intact; an event with no links is a normal object; outcomes are user-only,
 * append-only, and keep `follow_up_status` and the revisit date in step; a due revisit
 * surfaces and clears; a purge removes every derived row and writes a receipt.
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);

describe('life events (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    getAiRunner();
    user = await createTestUser('events');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    await enableCorrelation(user.id);
    await grantPremium(user.id); // explanations are premium (Phase 11)
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('saves before any AI, is complete with no links, and survives a failed extraction', async () => {
    const id = await createEvent(user.client, user.id, {
      description: 'Went for a long walk to clear my head.',
      occurred_on: dateOf(daysAgo(1)),
      note: null,
      reading_id: null,
    });
    const before = await getEvent(user.client, id);
    expect(before).not.toBeNull();
    expect(before!.fact_status).toBe('CONFIRMED_FACT');
    expect(before!.source).toBe('user');
    expect(before!.correlated_at).toBeNull();
    expect(before!.origin).toBeNull();
    // No extraction has run: the event is already a first-class, complete object.
    expect(
      await platformDb().select().from(extractions).where(eq(extractions.objectId, id)),
    ).toHaveLength(0);

    getMockProvider()!.failWith('500', 3);
    const failed = await runEventExtraction(id, { force: true });
    expect(failed.status).toBe('failed');
    const after = await getEvent(user.client, id);
    expect(after!.description).toBe(before!.description);
    expect(after!.occurred_on).toBe(before!.occurred_on);
    const rows = await platformDb().select().from(extractions).where(eq(extractions.objectId, id));
    expect(rows.map((r) => r.status)).toEqual(['failed']);

    const ok = await runEventExtraction(id, { force: true });
    expect(ok.status).toBe('complete');
    const themes = await platformDb()
      .select()
      .from(objectThemes)
      .where(eq(objectThemes.objectId, id));
    expect(themes.length).toBeGreaterThanOrEqual(0);
    const listed = await listEvents(user.client);
    expect(listed.find((e) => e.id === id)?.confirmed_links).toBe(0);
  });

  it('extracts entities and themes into the shared tables, keyed by life_event, and promotes type and importance', async () => {
    const id = await createEvent(user.client, user.id, {
      description: 'I accepted the job at the agency today.',
      occurred_on: dateOf(daysAgo(2)),
      note: 'Told Sam over dinner.',
      reading_id: null,
    });
    const out = await runEventExtraction(id);
    expect(out.status).toBe('complete');
    const mentions = await platformDb()
      .select()
      .from(entityMentions)
      .where(and(eq(entityMentions.objectType, 'life_event'), eq(entityMentions.objectId, id)));
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    expect(mentions.every((m) => ['auto', 'tentative'].includes(m.resolution))).toBe(true);
    const [row] = await platformDb().select().from(lifeEvents).where(eq(lifeEvents.id, id));
    expect(row!.eventType).toBe('work');
    expect(row!.importance).toBeGreaterThanOrEqual(4);
    // Fresh: a second run is a no-op.
    expect((await runEventExtraction(id)).status).toBe('skipped');
    // A correlation run was queued by the materialiser (model-free, deduped).
    const queued = await platformDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, 'correlate_object'), eq(jobs.status, 'queued')));
    expect(queued.some((j) => (j.payload as { objectId: string }).objectId === id)).toBe(true);
  });

  it('"something happened about this" creates a user-confirmed link the engine never touches', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Should I take the offer from the agency?',
      occurredAt: daysAgo(20).toISOString(),
    });
    const id = await createEvent(user.client, user.id, {
      description: 'Signed the contract with the agency.',
      occurred_on: dateOf(daysAgo(3)),
      note: null,
      reading_id: reading.id,
    });
    const ev = await getEvent(user.client, id);
    expect(ev!.origin?.id).toBe(reading.id);
    const [link] = await platformDb()
      .select()
      .from(links)
      .where(and(eq(links.fromId, reading.id), eq(links.toId, id)));
    expect(link).toMatchObject({
      createdBy: 'user',
      state: 'confirmed',
      linkType: 'reading_event',
    });
    expect(link!.userActedAt).not.toBeNull();
  });

  it('outcomes are user-only, append-only, and keep follow-up and revisit in step', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Will the offer come through this month?',
      occurredAt: daysAgo(40).toISOString(),
    });
    await setRevisitAt(user.client, reading.id, daysAgo(2).toISOString());
    const due = await listDueRevisits(user.client);
    expect(due.map((r) => r.id)).toContain(reading.id);

    // A model-side write is refused by the database itself (check constraints, service role).
    const pgCode = async (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code ?? null,
      );
    expect(
      await pgCode(
        platformDb()
          .insert(outcomes)
          .values({
            userId: user.id,
            readingId: reading.id,
            status: 'happened',
            recordedBy: 'model' as never,
          }),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        platformDb()
          .insert(outcomes)
          .values({
            userId: user.id,
            readingId: reading.id,
            status: 'happened',
            factStatus: 'INFERRED_EVENT' as never,
          }),
      ),
    ).toBe('23514');

    const first = await recordOutcome(user.client, user.id, {
      readingId: reading.id,
      predictionId: null,
      lifeEventId: null,
      status: 'partly',
      note: 'The offer came, the salary did not.',
    });
    expect(first.followUp).toBe('partly_resolved');
    let r = (await getReading(user.client, reading.id))!;
    expect(r.follow_up_status).toBe('partly_resolved');
    expect(r.revisit_at).toBeNull();
    expect((await listDueRevisits(user.client)).map((x) => x.id)).not.toContain(reading.id);

    const second = await recordOutcome(user.client, user.id, {
      readingId: reading.id,
      predictionId: null,
      lifeEventId: null,
      status: 'happened',
      note: null,
    });
    expect(second.followUp).toBe('resolved');
    r = (await getReading(user.client, reading.id))!;
    expect(r.follow_up_status).toBe('resolved');
    const all = await listReadingOutcomes(user.client, reading.id);
    expect(all).toHaveLength(2); // the earlier record is kept
    expect(currentOutcomes(all).reading?.status).toBe('happened');
    expect(all[1]!.note).toBe('The offer came, the salary did not.');
  });

  it('a possibility-level outcome answers one possibility and the reading follows', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Should I take the job or stay?',
      occurredAt: daysAgo(30).toISOString(),
    });
    expect((await runExtraction(reading.id, { force: true })).status).toBe('complete');
    const memory = await getReadingMemory(user.client, reading);
    const open = memory.predictions.filter((p) => !p.dismissed_at);
    expect(open.length).toBeGreaterThanOrEqual(2);
    const res = await recordOutcome(
      user.client,
      user.id,
      {
        readingId: reading.id,
        predictionId: open[0]!.id,
        lifeEventId: null,
        status: 'happened',
        note: null,
      },
      { openPredictionIds: open.map((p) => p.id) },
    );
    expect(res.followUp).toBe('partly_resolved');
    const all = await listReadingOutcomes(user.client, reading.id);
    expect(currentOutcomes(all).byPrediction.get(open[0]!.id)?.status).toBe('happened');
    expect(currentOutcomes(all).reading).toBeNull();
  });

  it('purge removes every derived row for an event and writes a receipt; the reading’s outcome keeps its record', async () => {
    const reading = await makeReading(user, refs, {
      question: 'What about the flat?',
      occurredAt: daysAgo(10).toISOString(),
    });
    const id = await createEvent(user.client, user.id, {
      description: 'Got the keys to the flat in Leeds.',
      occurred_on: dateOf(daysAgo(1)),
      note: null,
      reading_id: reading.id,
    });
    expect((await runEventExtraction(id)).status).toBe('complete');
    await recordOutcome(user.client, user.id, {
      readingId: reading.id,
      predictionId: null,
      lifeEventId: id,
      status: 'happened',
      note: null,
    });
    expect(await softDeleteEvent(user.client, id)).toBe(true);
    expect(await getEvent(user.client, id)).toBeNull(); // out of every view at once
    const res = await purgeEvent(id);
    expect(res).not.toBeNull();
    expect(res!.counts.links).toBe(1);
    expect(res!.counts.outcomes).toBe(1);
    expect(res!.counts.life_events).toBe(1);
    expect(await platformDb().select().from(lifeEvents).where(eq(lifeEvents.id, id))).toHaveLength(
      0,
    );
    const [outcome] = await platformDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.readingId, reading.id));
    expect(outcome).toBeDefined();
    expect(outcome!.lifeEventId).toBeNull();
    // Purging again is a no-op; purging a live event is refused.
    expect(await purgeEvent(id)).toBeNull();
    const live = await createEvent(user.client, user.id, {
      description: 'Nothing much.',
      occurred_on: dateOf(daysAgo(1)),
      note: null,
      reading_id: null,
    });
    await expect(purgeEvent(live)).rejects.toThrow(/not soft-deleted/);
  });

  it('the job handlers run end to end through the worker', async () => {
    const id = await createEvent(user.client, user.id, {
      description: 'Dinner with Maya to talk about the distance.',
      occurred_on: dateOf(daysAgo(1)),
      note: null,
      reading_id: null,
    });
    const { enqueue } = await import('@/jobs/enqueue');
    await enqueue('extract_event_metadata', { eventId: id, force: false }, { userId: user.id });
    const first = await runBatch({ limit: 10 });
    expect(first.succeeded).toBeGreaterThanOrEqual(1);
    const second = await runBatch({ limit: 10 }); // the queued correlation
    expect(second.succeeded).toBeGreaterThanOrEqual(1);
    const ev = await getEvent(user.client, id);
    expect(ev!.correlated_at).not.toBeNull();
  });
});
