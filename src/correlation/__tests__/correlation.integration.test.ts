import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, resetAiForTests } from '@/ai';
import { closeAdmin, platformDb } from '@/db/admin';
import { entities, entityMentions, jobs, links } from '@/db/schema';
import { runExplainCorrelation } from '@/correlation/explain';
import { correlateObject } from '@/correlation/run';
import {
  actOnLink,
  createEvent,
  listLinksForObject,
  loadLinkedObjects,
  undoLinkAction,
} from '@/db/queries/events';
import { setAiConsent } from '@/db/queries/profile';
import { setRevisitAt } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { MAX_SUGGESTIONS } from '@/domain/correlation/thresholds';
import { runEventExtraction } from '@/events/extract';
import { runBatch } from '@/jobs/worker';
import { applyCorrection } from '@/memory/corrections';
import { runExtraction } from '@/memory/extract';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableCorrelation, enableExtraction } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * The reading-to-reality loop against Postgres with the mock provider (spec §6.4, §8.2,
 * FR-12, FR-13, §19): an event about the agency, three weeks after a reading about the
 * agency's offer with a revisit horizon, is offered as a likely connection with its reasons;
 * the explainer writes one sentence and nothing else; confirm / maybe / reject persist with
 * `user_acted_at` and are undoable; a rejected link does not come back on an unchanged
 * re-run and comes back once when the user confirms the shared entity; at most three are
 * offered however many readings match; an event nothing matches is a normal, complete
 * object with `correlated_at` set.
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);

describe('correlation (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    getAiRunner();
    user = await createTestUser('correlation');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    await enableCorrelation(user.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  const agencyReading = async (daysBack: number, question: string) => {
    const r = await makeReading(user, refs, {
      question,
      notes: 'The agency wants an answer. Decide by next month.',
      occurredAt: daysAgo(daysBack).toISOString(),
      lifeArea: 'work',
    });
    // The user's own horizon: "revisit in a month" (the mock extractor yields no ISO dates).
    await setRevisitAt(user.client, r.id, daysAgo(daysBack - 35).toISOString());
    expect((await runExtraction(r.id, { force: true })).status).toBe('complete');
    return r;
  };

  it('offers the agency reading as a likely connection with reasons, explains it, and remembers decisions', async () => {
    const reading = await agencyReading(21, 'Should I take the offer from the agency?');
    const other = await makeReading(user, refs, {
      question: 'How do I sleep better?',
      notes: 'Tired all the time.',
      occurredAt: daysAgo(15).toISOString(),
    });
    expect((await runExtraction(other.id, { force: true })).status).toBe('complete');

    const eventId = await createEvent(user.client, user.id, {
      description: 'I accepted the job at the agency today.',
      occurred_on: dateOf(daysAgo(0)),
      note: null,
      reading_id: null,
    });
    expect((await runEventExtraction(eventId)).status).toBe('complete');
    const out = await correlateObject('life_event', eventId);
    expect(out.skipped).toBeUndefined();
    expect(out.candidates).toBeGreaterThanOrEqual(2);
    expect(out.offered).toBe(1);

    const offered = await listLinksForObject(user.client, { type: 'life_event', id: eventId });
    expect(offered).toHaveLength(1);
    const link = offered[0]!;
    expect(link.from_id).toBe(reading.id);
    expect(link.state).toBe('pending');
    expect(link.created_by).toBe('rule');
    expect(link.band).toBe('likely');
    expect(link.reasons).toContain('Both mention the agency');
    expect(link.reasons.some((r) => /window covers this date/.test(r))).toBe(true);
    expect(link.reasons.some((r) => /apart$/.test(r))).toBe(true);
    for (const r of link.reasons) expect(r).not.toMatch(/\d/);
    expect(link.signals!.entity_overlap).toBe(1);
    expect(link.signals!.timeframe_fit).toBe(1);
    expect(link.signals!.card_symbol_overlap).toBe(0);
    const linked = await loadLinkedObjects(user.client, offered);
    expect(linked.readings.get(reading.id)?.cards.map((c) => c.name)).toEqual([
      'Strength',
      'The Tower',
      'Ace of Cups',
    ]);
    // The sleep reading is not a candidate the user sees.
    const stored = await platformDb().select().from(links).where(eq(links.toId, eventId));
    expect(stored.find((l) => l.fromId === other.id)).toBeUndefined();

    // The explainer was queued (consent) and writes prose + provenance only.
    const queued = await platformDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, 'explain_correlation'), eq(jobs.status, 'queued')));
    expect(queued.some((j) => (j.payload as { linkId: string }).linkId === link.id)).toBe(true);
    const explained = await runExplainCorrelation(link.id);
    expect(explained.status).toBe('explained');
    const [row] = await platformDb().select().from(links).where(eq(links.id, link.id));
    expect(row!.explanation).toMatch(/agency/);
    expect(row!.explanation).not.toMatch(/\d/);
    expect(row!.explainedModelId).toBe('mock/claude-haiku-4-5');
    expect(row!.explainedPromptVersion).toBe('explain_correlation/1.0.0');
    expect(row!.state).toBe('pending');
    expect(Number(row!.score)).toBe(link.score);
    expect(row!.userActedAt).toBeNull();

    // Maybe → confirm → undo → reject, each a user act.
    let acted = await actOnLink(user.client, link.id, 'maybe');
    expect(acted.state).toBe('maybe');
    expect(acted.user_acted_at).not.toBeNull();
    acted = await actOnLink(user.client, link.id, 'confirmed');
    expect(acted.state).toBe('confirmed');
    expect(acted.band).toBe('confirmed');
    acted = await undoLinkAction(user.client, link.id);
    expect(acted.state).toBe('pending');
    expect(acted.user_acted_at).toBeNull();
    // A re-run refreshes a decided row's evidence but never its state.
    await actOnLink(user.client, link.id, 'confirmed');
    await correlateObject('life_event', eventId);
    const [still] = await platformDb().select().from(links).where(eq(links.id, link.id));
    expect(still!.state).toBe('confirmed');
    expect(still!.explanation).toMatch(/agency/);
  });

  it('a rejected link is not re-suggested on an unchanged re-run, and returns once on a confirmed overlap', async () => {
    const reading = await agencyReading(30, 'What does the agency really want from me?');
    const eventId = await createEvent(user.client, user.id, {
      description: 'The agency called about the role.',
      occurred_on: dateOf(daysAgo(10)),
      note: null,
      reading_id: null,
    });
    expect((await runEventExtraction(eventId)).status).toBe('complete');
    await correlateObject('life_event', eventId);
    const [offered] = (
      await listLinksForObject(user.client, { type: 'life_event', id: eventId })
    ).filter((l) => l.from_id === reading.id);
    expect(offered).toBeDefined();
    const rejected = await actOnLink(user.client, offered!.id, 'rejected');
    expect(rejected.state).toBe('rejected');
    const [afterReject] = await platformDb().select().from(links).where(eq(links.id, offered!.id));
    expect(afterReject!.rejectedFingerprint).toBe(afterReject!.evidenceFingerprint);
    expect(Number(afterReject!.rejectedScore)).toBe(offered!.score);

    // Unchanged evidence, both directions: nothing.
    await correlateObject('life_event', eventId);
    await correlateObject('reading', reading.id);
    const [same] = await platformDb().select().from(links).where(eq(links.id, offered!.id));
    expect(same!.state).toBe('rejected');
    expect(same!.userActedAt).not.toBeNull();
    expect(
      (await listLinksForObject(user.client, { type: 'life_event', id: eventId })).filter(
        (l) => l.state === 'pending' && l.from_id === reading.id,
      ),
    ).toEqual([]);

    // Materially new evidence: the user links the event's mention to the agency by hand
    // (a user-confirmed entity overlap that did not exist at the rejection).
    const [agency] = await platformDb()
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.userId, user.id), eq(entities.canonicalLabel, 'the agency')));
    const [mention] = await platformDb()
      .select()
      .from(entityMentions)
      .where(
        and(eq(entityMentions.objectType, 'life_event'), eq(entityMentions.objectId, eventId)),
      );
    expect(agency).toBeDefined();
    expect(mention).toBeDefined();
    await applyCorrection(
      user.client,
      user.id,
      eventId,
      {
        type: 'link_entity',
        mention: mention!.mentionText,
        entityId: agency!.id,
      },
      'life_event',
    );
    await correlateObject('life_event', eventId);
    const [back] = await platformDb().select().from(links).where(eq(links.id, offered!.id));
    expect(back!.state).toBe('pending');
    expect(back!.userActedAt).toBeNull();
    expect(back!.offeredAt).not.toBeNull();
    // Rejected again with the same confirmed overlap on record: it stays rejected for good.
    await actOnLink(user.client, offered!.id, 'rejected');
    await correlateObject('life_event', eventId);
    const [gone] = await platformDb().select().from(links).where(eq(links.id, offered!.id));
    expect(gone!.state).toBe('rejected');
  });

  it(`offers at most ${MAX_SUGGESTIONS} however many readings match, and a match-less event is complete`, async () => {
    for (let i = 0; i < 5; i++)
      await agencyReading(40 + i * 3, `Is the agency the right place for me? (${i})`);
    const eventId = await createEvent(user.client, user.id, {
      description: 'Handed in my notice at the agency.',
      occurred_on: dateOf(daysAgo(5)),
      note: null,
      reading_id: null,
    });
    expect((await runEventExtraction(eventId)).status).toBe('complete');
    const out = await correlateObject('life_event', eventId);
    expect(out.stored).toBeGreaterThan(MAX_SUGGESTIONS);
    expect(out.offered).toBe(MAX_SUGGESTIONS);
    const visible = await listLinksForObject(user.client, { type: 'life_event', id: eventId });
    expect(visible.filter((l) => l.state === 'pending')).toHaveLength(MAX_SUGGESTIONS);
    // The rest are stored for re-scoring, never offered.
    const all = await platformDb().select().from(links).where(eq(links.toId, eventId));
    expect(all.filter((l) => l.offeredAt === null).length).toBe(out.stored - MAX_SUGGESTIONS);
    // Deciding one does not promote a hidden one (the cap is per object, not per screen).
    await actOnLink(user.client, visible[0]!.id, 'rejected');
    await correlateObject('life_event', eventId);
    expect(
      (await listLinksForObject(user.client, { type: 'life_event', id: eventId })).filter(
        (l) => l.state === 'pending',
      ),
    ).toHaveLength(MAX_SUGGESTIONS - 1);

    const quiet = await createEvent(user.client, user.id, {
      description: 'Went for a long walk to clear my head.',
      occurred_on: dateOf(daysAgo(0)),
      note: null,
      reading_id: null,
    });
    expect((await runEventExtraction(quiet)).status).toBe('complete');
    const none = await correlateObject('life_event', quiet);
    expect(none.offered).toBe(0);
    expect(none.stored).toBe(0);
    expect(await listLinksForObject(user.client, { type: 'life_event', id: quiet })).toEqual([]);
    // The worker path sets correlated_at so the screen can say "nothing found" honestly.
    const { enqueue } = await import('@/jobs/enqueue');
    await enqueue(
      'correlate_object',
      { objectType: 'life_event', objectId: quiet },
      { userId: user.id },
    );
    expect((await runBatch({ limit: 20 })).succeeded).toBeGreaterThanOrEqual(1);
  });

  it('runs in the other direction: a newly extracted reading is scored against past events', async () => {
    const eventId = await createEvent(user.client, user.id, {
      description: 'Maya and I finally talked about the distance.',
      occurred_on: dateOf(daysAgo(2)),
      note: null,
      reading_id: null,
    });
    expect((await runEventExtraction(eventId)).status).toBe('complete');
    const reading = await makeReading(user, refs, {
      question: 'How do I talk to Maya about the distance?',
      notes: 'Maya keeps her distance; the conversation is not happening.',
      occurredAt: daysAgo(12).toISOString(),
      lifeArea: 'relationships',
    });
    expect((await runExtraction(reading.id, { force: true })).status).toBe('complete');
    const out = await correlateObject('reading', reading.id);
    expect(out.offered).toBe(1);
    const mine = await listLinksForObject(user.client, { type: 'reading', id: reading.id });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to_id).toBe(eventId);
    expect(mine[0]!.reasons).toContain('Both mention Maya');
  });
});
