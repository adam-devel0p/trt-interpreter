import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, getEmbedder, getMockProvider, resetAiForTests } from '@/ai';
import type { Embedder } from '@/ai/providers/openai-embeddings';
import { closeAdmin, platformDb } from '@/db/admin';
import {
  asks,
  embeddings,
  entities,
  entityMentions,
  lifeEvents,
  links,
  retrievalDocuments,
} from '@/db/schema';
import { actOnLink, createEvent, recordOutcome } from '@/db/queries/events';
import { addReadingToJourney, createJourney } from '@/db/queries/journeys';
import { setAiConsent } from '@/db/queries/profile';
import { softDeleteReading } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { hashEmbedding } from '@/domain/retrieval/hashEmbedding';
import { EMPTY_QUERY, type HistoryQuery } from '@/domain/retrieval/query';
import { runEventExtraction } from '@/events/extract';
import { applyCorrection } from '@/memory/corrections';
import { runExtraction } from '@/memory/extract';
import { purgeReading } from '@/privacy/purge';
import { askHistory, type AskEvent, type AskResult } from '@/retrieval/ask';
import { backfillEmbeddings, embedObject } from '@/retrieval/backfill';
import { rebuildRetrievalDocument } from '@/retrieval/documents';
import { embedDocument } from '@/retrieval/embed';
import { loadHistoryObjects } from '@/retrieval/objects';
import { resolveHints, searchHistory } from '@/retrieval/search';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableExtraction, grantPremium } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * Retrieval and Ask My History against Postgres with the mock provider (spec §8, §6.6, §19):
 * documents are built from stored rows and embedded from the stored text alone; an unchanged
 * hash sends nothing; a changed outcome or correction rebuilds; vectors die with their parent
 * by trigger and by the purge job; the backfill is idempotent; the package never holds a
 * soft-deleted object, a rejected link or a tentative entity; a fabricated citation is
 * stripped and an uncited answer degrades to "not enough evidence"; another user's scope id
 * returns nothing; a journey scope cites journey evidence only; 1000 objects stay under the
 * bound.
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);

async function runAsk(
  user: TestUser,
  question: string,
  opts: { scope?: Parameters<typeof askHistory>[0]['scope']; parsed?: HistoryQuery } = {},
): Promise<{ events: AskEvent[]; result: AskResult | null }> {
  const events: AskEvent[] = [];
  let result: AskResult | null = null;
  for await (const e of askHistory({
    client: user.client,
    userId: user.id,
    question,
    scope: opts.scope ?? { kind: 'all' },
    runner: getAiRunner(),
    embedder: getEmbedder(),
    parsed: opts.parsed,
  })) {
    events.push(e);
    if (e.type === 'complete') result = e.result;
  }
  return { events, result };
}

describe('retrieval (integration)', () => {
  let user: TestUser;
  let other: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    getAiRunner();
    user = await createTestUser('retrieval');
    other = await createTestUser('retrieval-other');
    await setAiConsent(user.client, user.id, true);
    await setAiConsent(other.client, other.id, true);
    await enableExtraction(user.id);
    await enableExtraction(other.id);
    // Ask My History is premium (Phase 11); the users here are entitled subscribers.
    await grantPremium(user.id);
    await grantPremium(other.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await deleteTestUser(other);
    await closeAdmin();
  });

  it('builds the document from stored rows, embeds exactly that text, and skips unchanged hashes', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Should I take the offer from the agency?',
      notes: 'The agency wants an answer. Sam says take it. PRIVATE-NOTE-MARKER.',
      occurredAt: daysAgo(30).toISOString(),
      lifeArea: 'work',
      deck: 'thoth',
    });
    expect((await runExtraction(reading.id, { force: true })).status).toBe('complete');

    const built = await rebuildRetrievalDocument('reading', reading.id);
    expect(built.status).toBe('built');
    const [doc] = await platformDb()
      .select()
      .from(retrievalDocuments)
      .where(eq(retrievalDocuments.id, built.documentId!));
    expect(doc!.text).toMatch(/^Should I take the offer from the agency\. Life area: Work/);
    expect(doc!.text).toMatch(/Cards \(Thoth\): Lust, The Universe, Princess of Disks/);
    expect(doc!.text).toMatch(/Entities: .*the agency/);
    // Never the notes, never the other deck's names.
    expect(doc!.text).not.toContain('PRIVATE-NOTE-MARKER');
    expect(doc!.text).not.toContain('Strength');
    expect(doc!.builderVersion).toBe('retrieval_document/1.1.0');

    // The outbound payload is the stored text, byte for byte, and nothing else.
    const sent: string[][] = [];
    const spy: Embedder = {
      id: 'spy',
      embed: async (req) => {
        sent.push(req.texts);
        return getEmbedder().embed(req);
      },
    };
    const first = await embedDocument(doc!.id, spy);
    expect(first.status).toBe('embedded');
    expect(sent).toEqual([[doc!.text]]);
    const [emb] = await platformDb()
      .select()
      .from(embeddings)
      .where(eq(embeddings.retrievalDocumentId, doc!.id));
    expect(emb!.model).toBe('mock-embed');
    expect(emb!.contentHash).toBe(doc!.contentHash);
    expect(emb!.vector).toHaveLength(1536);
    expect(emb!.objectId).toBe(reading.id);

    // Same hash → nothing sent.
    expect((await embedDocument(doc!.id, spy)).status).toBe('fresh');
    expect((await rebuildRetrievalDocument('reading', reading.id)).status).toBe('unchanged');
    expect(sent).toHaveLength(1);

    // The user's outcome changes the text; a correction changes it again.
    await recordOutcome(
      user.client,
      user.id,
      {
        readingId: reading.id,
        predictionId: null,
        lifeEventId: null,
        status: 'happened',
        note: 'Took it.',
      },
      { openPredictionIds: [] },
    );
    const rebuilt = await rebuildRetrievalDocument('reading', reading.id);
    expect(rebuilt.status).toBe('built');
    expect(rebuilt.contentHash).not.toBe(doc!.contentHash);
    const [doc2] = await platformDb()
      .select()
      .from(retrievalDocuments)
      .where(eq(retrievalDocuments.id, doc!.id));
    expect(doc2!.text).toMatch(/Outcome: happened — Took it/);
    expect((await embedDocument(doc!.id, spy)).status).toBe('embedded');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([doc2!.text]);

    await applyCorrection(user.client, user.id, reading.id, {
      type: 'add_theme',
      label: 'Courage',
    });
    const corrected = await rebuildRetrievalDocument('reading', reading.id);
    expect(corrected.status).toBe('built');
    const [doc3] = await platformDb()
      .select()
      .from(retrievalDocuments)
      .where(eq(retrievalDocuments.id, doc!.id));
    expect(doc3!.text).toMatch(/Themes: .*Courage/);
    // One current row per object throughout.
    const rows = await platformDb()
      .select()
      .from(retrievalDocuments)
      .where(eq(retrievalDocuments.objectId, reading.id));
    expect(rows).toHaveLength(1);
  });

  it('the job path: an event without consent gets a document but no vector; with consent both', async () => {
    const noConsent = await createTestUser('retrieval-noconsent');
    try {
      const r = await makeReading(noConsent, await loadJournalRefs(noConsent), {
        question: 'Quiet one?',
      });
      const out = await embedObject('reading', r.id);
      expect(out).toEqual({
        document: 'built',
        embedding: 'skipped_consent',
        errorClass: undefined,
      });
      const n = await platformDb()
        .select()
        .from(embeddings)
        .where(eq(embeddings.userId, noConsent.id));
      expect(n).toHaveLength(0);
    } finally {
      await deleteTestUser(noConsent);
    }
    const eventId = await createEvent(user.client, user.id, {
      description: 'I accepted the job at the agency today.',
      occurred_on: dateOf(daysAgo(2)),
      note: 'Never embedded either.',
      reading_id: null,
    });
    expect((await runEventExtraction(eventId)).status).toBe('complete');
    const out = await embedObject('life_event', eventId);
    expect(out.document).toBe('built');
    expect(out.embedding).toBe('embedded');
    const [doc] = await platformDb()
      .select()
      .from(retrievalDocuments)
      .where(eq(retrievalDocuments.objectId, eventId));
    expect(doc!.text).toMatch(/^I accepted the job at the agency today\. Event: Work/);
    expect(doc!.text).not.toContain('Never embedded');
  });

  it('vectors die with their parent: the purge job for a reading, the trigger for an event', async () => {
    const reading = await makeReading(user, refs, { question: 'Will this be purged?' });
    await embedObject('reading', reading.id);
    expect(
      await platformDb().select().from(embeddings).where(eq(embeddings.objectId, reading.id)),
    ).toHaveLength(1);
    await softDeleteReading(user.client, reading.id);
    // Out of retrieval before the purge: a rebuild for a soft-deleted object removes the row.
    expect((await rebuildRetrievalDocument('reading', reading.id)).status).toBe('deleted');
    const purged = await purgeReading(reading.id);
    expect(purged!.counts.retrieval_documents).toBe(0);
    expect(
      await platformDb().select().from(embeddings).where(eq(embeddings.objectId, reading.id)),
    ).toHaveLength(0);

    const eventId = await createEvent(user.client, user.id, {
      description: 'Gone by trigger.',
      occurred_on: dateOf(daysAgo(1)),
      note: null,
      reading_id: null,
    });
    await embedObject('life_event', eventId);
    expect(
      await platformDb().select().from(embeddings).where(eq(embeddings.objectId, eventId)),
    ).toHaveLength(1);
    await platformDb().delete(lifeEvents).where(eq(lifeEvents.id, eventId));
    expect(
      await platformDb()
        .select()
        .from(retrievalDocuments)
        .where(eq(retrievalDocuments.objectId, eventId)),
    ).toHaveLength(0);
    expect(
      await platformDb().select().from(embeddings).where(eq(embeddings.objectId, eventId)),
    ).toHaveLength(0);
  });

  it('the backfill builds what is missing once and is a no-op the second time', async () => {
    await makeReading(user, refs, {
      question: 'Backfill me?',
      occurredAt: daysAgo(40).toISOString(),
    });
    await makeReading(user, refs, { question: null, occurredAt: daysAgo(41).toISOString() });
    const first = await backfillEmbeddings({ userId: user.id, limit: 100 });
    expect(first.built).toBeGreaterThanOrEqual(2);
    expect(first.embedded).toBeGreaterThanOrEqual(2);
    expect(first.failed).toBe(0);
    expect(first.more).toBe(false);
    const second = await backfillEmbeddings({ userId: user.id, limit: 100 });
    expect(second).toMatchObject({ built: 0, embedded: 0, failed: 0, more: false });
    // A model change makes every vector stale: simulate by rewriting the stored model.
    await platformDb()
      .update(embeddings)
      .set({ model: 'text-embedding-old' })
      .where(eq(embeddings.userId, user.id));
    const third = await backfillEmbeddings({ userId: user.id, limit: 100 });
    expect(third.embedded).toBeGreaterThanOrEqual(3);
    expect(third.built).toBe(0);
  });

  it('the package excludes soft-deleted objects, rejected links and tentative entities; a fabricated citation is stripped; an uncited answer degrades', async () => {
    const maya1 = await makeReading(user, refs, {
      question: 'What does Maya need from me right now?',
      notes: 'Maya wants a conversation.',
      occurredAt: daysAgo(60).toISOString(),
      lifeArea: 'relationships',
    });
    const maya2 = await makeReading(user, refs, {
      question: 'How are things really with Maya?',
      occurredAt: daysAgo(20).toISOString(),
      lifeArea: 'relationships',
    });
    const gone = await makeReading(user, refs, {
      question: 'Deleted Maya reading?',
      occurredAt: daysAgo(10).toISOString(),
      lifeArea: 'relationships',
    });
    for (const r of [maya1, maya2, gone]) {
      expect((await runExtraction(r.id, { force: true })).status).toBe('complete');
      await embedObject('reading', r.id);
    }
    await softDeleteReading(user.client, gone.id);

    // A rejected rule link from maya2 to an event, and a confirmed one from maya1.
    const talked = await createEvent(user.client, user.id, {
      description: 'Maya and I had the conversation.',
      occurred_on: dateOf(daysAgo(55)),
      note: null,
      reading_id: null,
    });
    const unrelated = await createEvent(user.client, user.id, {
      description: 'Dinner with Sam, nothing to do with it.',
      occurred_on: dateOf(daysAgo(19)),
      note: null,
      reading_id: null,
    });
    for (const e of [talked, unrelated]) {
      expect((await runEventExtraction(e)).status).toBe('complete');
      await embedObject('life_event', e);
    }
    const [confirmedRow] = await platformDb()
      .insert(links)
      .values({
        userId: user.id,
        fromType: 'reading',
        fromId: maya1.id,
        toType: 'life_event',
        toId: talked,
        linkType: 'reading_event',
        score: '0.800',
        createdBy: 'rule',
        evidenceFingerprint: 'fp1',
        offeredAt: new Date(),
      })
      .returning({ id: links.id });
    const [rejectedRow] = await platformDb()
      .insert(links)
      .values({
        userId: user.id,
        fromType: 'reading',
        fromId: maya2.id,
        toType: 'life_event',
        toId: unrelated,
        linkType: 'reading_event',
        score: '0.700',
        createdBy: 'rule',
        evidenceFingerprint: 'fp2',
        offeredAt: new Date(),
      })
      .returning({ id: links.id });
    await actOnLink(user.client, confirmedRow!.id, 'confirmed');
    await actOnLink(user.client, rejectedRow!.id, 'rejected');

    // A tentative mention of a second entity on maya2: never a fact.
    const [ghost] = await platformDb()
      .insert(entities)
      .values({ userId: user.id, kind: 'person', canonicalLabel: 'Priya', status: 'active' })
      .returning({ id: entities.id });
    await platformDb().insert(entityMentions).values({
      userId: user.id,
      entityId: ghost!.id,
      objectType: 'reading',
      objectId: maya2.id,
      mentionText: 'P.',
      mentionNormalized: 'p',
      resolution: 'tentative',
      confidence: '0.400',
    });
    await embedObject('reading', maya2.id);

    const parsed: HistoryQuery = {
      ...EMPTY_QUERY,
      intent: 'change_over_time',
      life_area: 'relationships',
      entity_hints: ['Maya'],
      object_types: ['reading'],
      keywords: ['maya'],
    };
    const { result } = await runAsk(user, 'How have my Maya readings changed?', { parsed });
    expect(result).not.toBeNull();
    const ids = result!.packageSize;
    expect(ids).toBeGreaterThanOrEqual(2);
    const pkgIds = (await platformDb().select().from(asks).where(eq(asks.id, result!.askId)))[0]!
      .packageObjectIds as { id: string }[];
    const seen = pkgIds.map((p) => p.id);
    expect(seen).toContain(maya1.id);
    expect(seen).toContain(maya2.id);
    expect(seen).toContain(talked); // augmented through the confirmed link
    expect(seen).not.toContain(gone.id);
    expect(seen).not.toContain(unrelated); // the rejected link never pulls its event in
    // The evidence the model saw names Maya but never the tentative Priya.
    const objects = await loadHistoryObjects(user.id, { readings: [maya2.id] });
    expect(objects.get(maya2.id)!.entities).not.toContain('Priya');
    expect(objects.get(maya2.id)!.links).toEqual([]);
    expect(objects.get(maya2.id)!.entities.some((e) => /maya/i.test(e))).toBe(true);
    // Tentative entities do not count as hits either.
    const hints = await resolveHints(user.client, { ...EMPTY_QUERY, entity_hints: ['Priya'] });
    expect(hints.entityIds).toContain(ghost!.id);
    const rows = await searchHistory(user.client, {
      query: { ...EMPTY_QUERY, entity_hints: ['Priya'] },
      scope: { kind: 'all' },
      hints,
      vector: null,
    });
    expect(rows.find((r) => r.id === maya2.id)!.entityHits).toBe(0);
    expect(result!.answer.evidence_sufficient).toBe(true);
    expect(result!.citations.every((c) => seen.includes(c.object_id))).toBe(true);

    // Step 7: a fabricated label is stripped; a claim left uncited triggers one regeneration.
    const mock = getMockProvider()!;
    mock.respondWith({
      evidence_sufficient: true,
      conclusion: 'Grounded but sloppy.',
      claims: [{ text: 'A real claim.', citations: ['E1', 'E77'] }],
      found: null,
      narrower_question: null,
    });
    const sloppy = await runAsk(user, 'How have my Maya readings changed?', { parsed });
    expect(sloppy.result!.answer.evidence_sufficient).toBe(true);
    expect(sloppy.result!.claims[0]!.citations.map((c) => c.label)).toEqual(['E1']);
    expect(sloppy.result!.citations).toHaveLength(1);

    const callsBefore = mock.calls.filter((c) => c.task === 'answer_from_evidence').length;
    mock.respondWith({
      evidence_sufficient: true,
      conclusion: 'A pattern I made up.',
      claims: [{ text: 'Invented.', citations: ['E99'] }],
      found: null,
      narrower_question: null,
    });
    mock.respondWith({
      evidence_sufficient: true,
      conclusion: 'Still made up.',
      claims: [{ text: 'Still invented.', citations: [] }],
      found: null,
      narrower_question: 'Something narrower?',
    });
    const degraded = await runAsk(user, 'How have my Maya readings changed?', { parsed });
    expect(mock.calls.filter((c) => c.task === 'answer_from_evidence').length - callsBefore).toBe(
      2,
    );
    expect(degraded.result!.answer.evidence_sufficient).toBe(false);
    expect(degraded.result!.claims).toEqual([]);
    expect(degraded.result!.answer.conclusion).toMatch(/not enough evidence/i);
    expect(degraded.result!.answer.found).toMatch(/Found \d+ readings? and \d+ life events?/);
    const [stored] = await platformDb()
      .select()
      .from(asks)
      .where(eq(asks.id, degraded.result!.askId));
    expect(stored!.status).toBe('complete');
    expect(stored!.evidenceSufficient).toBe(false);
    expect(stored!.answer).not.toContain('made up');
    expect(stored!.promptVersion).toBe('answer_from_evidence/1.0.0');
  });

  it('another user’s scope id returns nothing; a journey scope cites journey evidence only', async () => {
    const otherRefs = await loadJournalRefs(other);
    const theirs = await makeReading(other, otherRefs, {
      question: 'Their private question about Maya?',
      lifeArea: 'relationships',
    });
    await embedObject('reading', theirs.id);
    const theirJourney = await createJourney(other.client, other.id, 'Their journey', [theirs.id]);

    const crossScope = await runAsk(user, 'What is in this journey?', {
      scope: { kind: 'journey', journeyId: theirJourney },
      parsed: EMPTY_QUERY,
    });
    expect(crossScope.result!.packageSize).toBe(0);
    expect(crossScope.result!.answer.evidence_sufficient).toBe(false);
    expect(crossScope.result!.answer.found).toMatch(/Nothing in your history matched/);
    const crossEntity = await runAsk(user, 'About them?', {
      scope: { kind: 'entity', entityId: theirs.id },
      parsed: EMPTY_QUERY,
    });
    expect(crossEntity.result!.packageSize).toBe(0);
    // And never the other user's rows in an unscoped ask.
    const all = await runAsk(user, 'Maya', {
      parsed: { ...EMPTY_QUERY, entity_hints: ['Maya'], keywords: ['maya'] },
    });
    const pkg = (await platformDb().select().from(asks).where(eq(asks.id, all.result!.askId)))[0]!
      .packageObjectIds as { id: string }[];
    expect(pkg.map((p) => p.id)).not.toContain(theirs.id);

    // A journey of the user's own: members and their linked objects, nothing else.
    const a = await makeReading(user, refs, {
      question: 'Journey reading one about Leeds?',
      occurredAt: daysAgo(50).toISOString(),
    });
    const b = await makeReading(user, refs, {
      question: 'Journey reading two about Leeds?',
      occurredAt: daysAgo(45).toISOString(),
    });
    const outside = await makeReading(user, refs, {
      question: 'Leeds but not in the journey?',
      occurredAt: daysAgo(44).toISOString(),
    });
    for (const r of [a, b, outside]) await embedObject('reading', r.id);
    const journeyId = await createJourney(user.client, user.id, 'The move to Leeds', [a.id]);
    await addReadingToJourney(user.client, user.id, journeyId, b.id);
    const scoped = await runAsk(user, 'What about Leeds?', {
      scope: { kind: 'journey', journeyId },
      parsed: { ...EMPTY_QUERY, keywords: ['leeds'] },
    });
    const ids = (
      (await platformDb().select().from(asks).where(eq(asks.id, scoped.result!.askId)))[0]!
        .packageObjectIds as { id: string }[]
    ).map((p) => p.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
    expect(ids).not.toContain(outside.id);
    for (const c of scoped.result!.citations) expect([a.id, b.id]).toContain(c.object_id);
  });

  it('cancelling stops at the next step and marks the ask failed / cancelled', async () => {
    const abort = new AbortController();
    const events: AskEvent[] = [];
    for await (const e of askHistory({
      client: user.client,
      userId: user.id,
      question: 'Stop me?',
      scope: { kind: 'all' },
      runner: getAiRunner(),
      embedder: getEmbedder(),
      signal: abort.signal,
    })) {
      events.push(e);
      if (e.type === 'started') abort.abort();
    }
    const last = events[events.length - 1]!;
    expect(last.type).toBe('failed');
    if (last.type === 'failed') {
      expect(last.errorClass).toBe('cancelled');
      const [row] = await platformDb().select().from(asks).where(eq(asks.id, last.askId!));
      expect(row!.status).toBe('failed');
      expect(row!.errorClass).toBe('cancelled');
    }
  });

  it('stays under the bound at 1000 objects and records the timings', async () => {
    const bulk = await createTestUser('retrieval-bulk');
    try {
      await setAiConsent(bulk.client, bulk.id, true);
      await grantPremium(bulk.id);
      const bulkRefs = await loadJournalRefs(bulk);
      // Direct inserts: the rows retrieval reads, without walking the flow 1000 times.
      const spread = bulkRefs.spread('one-card');
      const cardId = bulkRefs.cardId('rws', 'the-star');
      const readingIds: string[] = [];
      const topics = ['Maya', 'the agency', 'Leeds', 'health', 'money', 'Sam', 'the flat', 'Dad'];
      for (let i = 0; i < 1000; i += 200) {
        const rows = await platformDb().execute<{ id: string }>(sql`
          insert into public.readings (user_id, question, is_open_reflection, spread_id, deck_id, source, uses_reversals, occurred_at)
          select ${bulk.id}::uuid, 'Question ' || g || ' about ' || (array[${sql.raw(topics.map((t) => `'${t}'`).join(','))}])[1 + (g % 8)], false, ${spread.id}::uuid, ${bulkRefs.rws.id}::uuid, 'physical', false, now() - (g || ' days')::interval
          from generate_series(${i}::int, ${i + 199}::int) g returning id`);
        for (const r of rows) readingIds.push(r.id);
      }
      await platformDb().execute(sql`
        insert into public.reading_cards (reading_id, user_id, position_index, position_key, card_id, orientation, sort_order)
        select id, ${bulk.id}::uuid, 0, 'card', ${cardId}::uuid, 'upright', 0 from public.readings where user_id = ${bulk.id}`);
      const t0 = Date.now();
      let rounds = 0;
      for (;;) {
        const out = await backfillEmbeddings({ userId: bulk.id, limit: 250 });
        rounds += 1;
        if (!out.more || rounds > 10) break;
      }
      const backfillMs = Date.now() - t0;
      const docs = await platformDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(retrievalDocuments)
        .where(eq(retrievalDocuments.userId, bulk.id));
      expect(Number(docs[0]!.n)).toBe(1000);

      const t1 = Date.now();
      const bulkQuery: HistoryQuery = {
        ...EMPTY_QUERY,
        entity_hints: ['Maya'],
        keywords: ['maya'],
      };
      const hints = await resolveHints(bulk.client, bulkQuery);
      const rows = await searchHistory(bulk.client, {
        query: bulkQuery,
        scope: { kind: 'all' },
        hints,
        vector: hashEmbedding('Question about Maya'),
      });
      const searchMs = Date.now() - t1;
      expect(rows.length).toBeLessThanOrEqual(400);
      expect(rows.length).toBe(400);
      expect(rows.every((r) => r.similarity !== null)).toBe(true);
      // Over the cap, keyword hits come first.
      expect(rows[0]!.keywordHits).toBe(1);

      const t2 = Date.now();
      const { result } = await runAsk(bulk, 'What have I asked about Maya?', {
        parsed: {
          ...EMPTY_QUERY,
          entity_hints: ['Maya'],
          keywords: ['maya'],
          object_types: ['reading'],
        },
      });
      const askMs = Date.now() - t2;
      expect(result!.packageSize).toBeLessThanOrEqual(24);
      expect(result!.droppedCount).toBeGreaterThan(0);
      const [row] = await platformDb().select().from(asks).where(eq(asks.id, result!.askId));
      expect(
        (row!.packageObjectIds as unknown[]).length + (row!.droppedObjectIds as unknown[]).length,
      ).toBeLessThanOrEqual(400);
      console.log(
        `retrieval perf @1000: backfill ${backfillMs} ms · search ${searchMs} ms · ask (mock) ${askMs} ms · package ${result!.packageSize} objects`,
      );
    } finally {
      await deleteTestUser(bulk);
    }
  });

  it('a session can insert only a pending, answerless ask (RLS)', async () => {
    const forged = await user.client.from('asks').insert({
      user_id: user.id,
      question: 'Forged?',
      scope: { kind: 'all' },
      status: 'complete',
      answer: 'I made this up.',
    });
    expect(forged.error?.code).toBe('42501');
    const ok = await user.client
      .from('asks')
      .insert({ user_id: user.id, question: 'Fine?', scope: { kind: 'all' } })
      .select('id')
      .single();
    expect(ok.error).toBeNull();
    await platformDb()
      .delete(asks)
      .where(and(eq(asks.userId, user.id), eq(asks.question, 'Fine?')));
  });
});
