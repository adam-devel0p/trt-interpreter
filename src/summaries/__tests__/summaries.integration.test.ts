import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, getMockProvider, resetAiForTests } from '@/ai';
import { closeAdmin, platformDb } from '@/db/admin';
import {
  journeyNarratives,
  periodSummaries,
  retentionPrompts,
  retrievalDocuments,
  embeddings,
} from '@/db/schema';
import { createEvent, recordOutcome } from '@/db/queries/events';
import { addReadingToJourney, createJourney } from '@/db/queries/journeys';
import { setAiConsent } from '@/db/queries/profile';
import { loadRetrospective } from '@/db/queries/retrospective';
import { softDeleteReading } from '@/db/queries/readings';
import {
  dismissPrompt,
  getJourneyNarrative,
  getRetentionSettings,
  getSummaryForPeriod,
  listRetentionPrompts,
  setRetentionSetting,
  setSummaryDismissed,
} from '@/db/queries/summaries';
import { seedReferenceData } from '@/db/seed/reference';
import { periodContaining } from '@/domain/summaries/periods';
import { refreshJourney } from '@/journeys/refresh';
import { purgeReading } from '@/privacy/purge';
import { loadHomeInsight } from '@/retention/home';
import { coveringSummaries } from '@/retrieval/summaries';
import { generatePeriodSummary } from '../generate';
import { generateJourneyNarrative } from '../narrative';
import { duePeriods } from '../schedule';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableExtraction, enableSummaries } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * Summaries, narratives and retention against Postgres with the mock provider (spec FR-20,
 * §6.5, §15.2, §19): nothing below the data floor; a generated summary stores every claim's
 * basis and citations as object ids and a non-empty source set; the empty set is refused
 * by the database; an ungrounded output is not stored; a narrative regenerates on material
 * change only; viewing makes zero model calls; dismissals persist; a deleted source scrubs
 * or removes the summary by job and by trigger; covering summaries join an Ask package
 * only for what the bound dropped; Home resurfaces at most one reading a day and honours
 * the switches.
 */
const DAY = 86_400_000;
// A complete month in the past: July 2026 relative to a mid-September "today".
const TODAY = new Date();
const lastMonth = periodContaining('monthly', new Date(TODAY.getTime() - 40 * DAY).toISOString());
const inMonth = (day: number) =>
  `${lastMonth.start.slice(0, 8)}${String(day).padStart(2, '0')}T12:00:00.000Z`;

async function aiCallCount(userId: string): Promise<number> {
  const rows = await platformDb().execute<{ n: number }>(
    sql`select count(*)::int as n from public.ai_calls where user_id = ${userId}`,
  );
  return Number(rows[0]?.n ?? 0);
}

describe('summaries (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    getAiRunner();
    user = await createTestUser('summaries');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    await enableSummaries(user.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('generates nothing below the floor, and a grounded, cited, sourced summary above it — viewed with zero calls', async () => {
    // Four objects in the month: under the monthly floor of five.
    const r1 = await makeReading(user, refs, {
      question: 'Should I take the agency job?',
      occurredAt: inMonth(2),
      lifeArea: 'work',
    });
    const r2 = await makeReading(user, refs, {
      question: 'What does the agency need from me?',
      occurredAt: inMonth(9),
      lifeArea: 'work',
    });
    const r3 = await makeReading(user, refs, {
      question: 'Is it time to leave the agency?',
      occurredAt: inMonth(16),
      lifeArea: 'work',
      cards: ['the-tower', 'strength', 'ace-of-cups'],
    });
    const r4 = await makeReading(user, refs, {
      question: 'How is it going with Maya?',
      occurredAt: inMonth(20),
      lifeArea: 'relationships',
    });
    const floor = await generatePeriodSummary({
      userId: user.id,
      kind: 'monthly',
      period: lastMonth,
    });
    expect(floor).toEqual({ status: 'skipped', reason: 'floor', objectCount: 4 });
    expect(
      await platformDb().select().from(periodSummaries).where(eq(periodSummaries.userId, user.id)),
    ).toEqual([]);
    expect(await duePeriods(user.id, 'monthly', 3, TODAY.toISOString())).toEqual([]);

    // A logged event with an outcome brings the month to five: the floor is met.
    const eventId = await createEvent(user.client, user.id, {
      description: 'Handed in my notice at the agency.',
      occurred_on: inMonth(24).slice(0, 10),
      note: null,
      reading_id: r3.id,
    });
    await recordOutcome(user.client, user.id, {
      readingId: r3.id,
      predictionId: null,
      lifeEventId: eventId,
      status: 'happened',
      note: 'Left on the 24th.',
    });
    const due = await duePeriods(user.id, 'monthly', 3, TODAY.toISOString());
    expect(due.map((p) => p.key)).toEqual([lastMonth.key]);
    expect(due[0]!.objectCount).toBe(5);

    const before = await aiCallCount(user.id);
    const out = await generatePeriodSummary({
      userId: user.id,
      kind: 'monthly',
      period: lastMonth,
    });
    expect(out.status).toBe('generated');
    expect((await aiCallCount(user.id)) - before).toBeGreaterThanOrEqual(1);
    const row = (
      await platformDb().select().from(periodSummaries).where(eq(periodSummaries.userId, user.id))
    )[0]!;
    const ids = new Set([r1.id, r2.id, r3.id, r4.id, eventId]);
    expect(row.sourceObjectIds.length).toBeGreaterThan(0);
    expect(row.sourceObjectIds.every((id) => ids.has(id))).toBe(true);
    expect(row.objectCount).toBe(5);
    expect(row.modelId).toMatch(/^mock\//);
    expect(row.promptVersion).toBe('summarize_period/1.0.0');
    const h = row.highlights as Record<
      string,
      { text: string; basis: string; citations: { type: string; id: string }[] }[]
    >;
    const claims = Object.values(h).flat();
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c.citations.length).toBeGreaterThan(0);
      for (const cit of c.citations) expect(ids.has(cit.id)).toBe(true);
    }
    // A "confirmed fact" only ever cites confirmed evidence: the event or the reading with the outcome.
    const facts = claims.filter((c) => c.basis === 'confirmed_fact');
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts)
      expect(f.citations.some((c) => c.id === eventId || c.id === r3.id)).toBe(true);
    // The summary is a retrieval-eligible object with a vector.
    const doc = (
      await platformDb()
        .select()
        .from(retrievalDocuments)
        .where(eq(retrievalDocuments.objectId, row.id))
    )[0]!;
    expect(doc.objectType).toBe('period_summary');
    expect(doc.text).not.toMatch(/PRIVATE|note/i);
    expect(
      await platformDb()
        .select()
        .from(embeddings)
        .where(eq(embeddings.retrievalDocumentId, doc.id)),
    ).toHaveLength(1);

    // Viewing: the stored row and the retrospective's data make no model call.
    const at = await aiCallCount(user.id);
    const view = await getSummaryForPeriod(user.client, 'monthly', lastMonth.start);
    expect(view?.id).toBe(row.id);
    const retro = await loadRetrospective(user.client, lastMonth);
    expect(retro.readings.map((r) => r.id).sort()).toEqual([r1.id, r2.id, r3.id, r4.id].sort());
    expect(retro.events.map((e) => e.id)).toEqual([eventId]);
    // The outcome was recorded today, outside the period: "outcomes recorded" is by date.
    expect(retro.outcomes).toHaveLength(0);
    expect(retro.confirmedLinks).toEqual([{ readingId: r3.id, eventId }]);
    expect(await aiCallCount(user.id)).toBe(at);

    // Unchanged evidence → no regeneration; force → regenerated; dismissal remembered.
    expect(
      await generatePeriodSummary({ userId: user.id, kind: 'monthly', period: lastMonth }),
    ).toEqual({ status: 'skipped', reason: 'unchanged' });
    await setSummaryDismissed(user.client, row.id, true);
    expect(
      (await getSummaryForPeriod(user.client, 'monthly', lastMonth.start))?.dismissed_at,
    ).not.toBeNull();
    expect(
      await generatePeriodSummary({
        userId: user.id,
        kind: 'monthly',
        period: lastMonth,
        force: true,
      }),
    ).toEqual({ status: 'skipped', reason: 'dismissed' });
    const forced = await generatePeriodSummary({
      userId: user.id,
      kind: 'monthly',
      period: lastMonth,
      force: true,
      includeDismissed: true,
    });
    expect(forced.status).toBe('generated');
    const again = (await getSummaryForPeriod(user.client, 'monthly', lastMonth.start))!;
    expect(again.id).toBe(row.id);
    expect(again.dismissed_at).toBeNull();
  });

  it('a session can dismiss but not rewrite a summary; the empty source set is refused by the database', async () => {
    const row = (
      await platformDb().select().from(periodSummaries).where(eq(periodSummaries.userId, user.id))
    )[0]!;
    const rewrite = await user.client
      .from('period_summaries')
      .update({ summary: 'Forged.' })
      .eq('id', row.id);
    expect(rewrite.error?.code).toBe('42501');
    await expect(
      platformDb()
        .insert(periodSummaries)
        .values({
          userId: user.id,
          scope: 'user',
          kind: 'weekly',
          periodStart: '2020-01-06',
          periodEnd: '2020-01-12',
          summary: 'Nothing',
          highlights: { recurred: [], shifted: [], open: [], confirmed: [] },
          sourceObjectIds: [],
          sources: [],
          objectCount: 0,
          inputHash: 'x',
          modelId: 'mock/x',
          promptVersion: 'p',
          schemaVersion: 's',
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('an ungrounded output is not stored (one repair, then nothing)', async () => {
    const mock = getMockProvider()!;
    const before = (await getSummaryForPeriod(user.client, 'monthly', lastMonth.start))!;
    const bad = {
      headline: 'Made up.',
      recurred: [{ text: 'Invented.', basis: 'confirmed_fact', citations: ['E42'] }],
      shifted: [],
      open: [],
      confirmed: [],
    };
    mock.respondWith(bad);
    mock.respondWith({ ...bad, headline: 'Still made up.' });
    const calls = mock.calls.filter((c) => c.task === 'summarize_period').length;
    const out = await generatePeriodSummary({
      userId: user.id,
      kind: 'monthly',
      period: lastMonth,
      force: true,
    });
    expect(mock.calls.filter((c) => c.task === 'summarize_period').length - calls).toBe(2);
    expect(out).toEqual({ status: 'skipped', reason: 'ungrounded' });
    // The earlier, grounded summary is untouched.
    const after = (await getSummaryForPeriod(user.client, 'monthly', lastMonth.start))!;
    expect(after.generated_at).toBe(before.generated_at);
    expect(after.summary).toBe(before.summary);
    expect(after.summary).not.toMatch(/made up/i);
  });

  it('a journey narrative is generated above the floor, served stored, and regenerated only on a material change', async () => {
    const readings = (
      await user.client
        .from('readings')
        .select('id, occurred_at')
        .eq('user_id', user.id)
        .order('occurred_at')
    ).data as { id: string }[];
    const journeyId = await createJourney(
      user.client,
      user.id,
      'The agency',
      readings.slice(0, 2).map((r) => r.id),
    );
    await refreshJourney(journeyId);
    expect(await generateJourneyNarrative(journeyId)).toEqual({
      status: 'skipped',
      reason: 'floor',
    });
    await addReadingToJourney(user.client, user.id, journeyId, readings[2]!.id);
    await refreshJourney(journeyId);
    const first = await generateJourneyNarrative(journeyId);
    expect(first).toMatchObject({ status: 'generated', reason: 'none' });
    const stored = (await getJourneyNarrative(user.client, journeyId))!;
    expect(stored.sentence.length).toBeGreaterThan(10);
    expect(
      stored.source_object_ids.every((id) => readings.slice(0, 3).some((r) => r.id === id)),
    ).toBe(true);
    // Same members → nothing; a new member → changed; two weeks later → aged.
    const at = await aiCallCount(user.id);
    expect(await generateJourneyNarrative(journeyId)).toEqual({
      status: 'skipped',
      reason: 'unchanged',
    });
    expect(await aiCallCount(user.id)).toBe(at);
    await addReadingToJourney(user.client, user.id, journeyId, readings[3]!.id);
    await refreshJourney(journeyId);
    expect(await generateJourneyNarrative(journeyId)).toMatchObject({
      status: 'generated',
      reason: 'changed',
    });
    expect(
      await generateJourneyNarrative(journeyId, { now: new Date(Date.now() + 15 * DAY) }),
    ).toMatchObject({ status: 'generated', reason: 'aged' });
    expect((await getJourneyNarrative(user.client, journeyId))!.id).toBe(stored.id);
    // A journey summary (kind journey) needs five entries; with four it stays empty.
    expect(
      await generatePeriodSummary({ userId: user.id, kind: 'journey', journeyId }),
    ).toMatchObject({ status: 'skipped', reason: 'floor' });
  });

  it('deleting a source scrubs the summary and marks it stale; the last source removes it (job and trigger)', async () => {
    const row = (
      await platformDb()
        .select()
        .from(periodSummaries)
        .where(and(eq(periodSummaries.userId, user.id), eq(periodSummaries.kind, 'monthly')))
    )[0]!;
    const victim = row.sourceObjectIds.find((id) =>
      (row.sources as { type: string; id: string }[]).some(
        (s) => s.id === id && s.type === 'reading',
      ),
    )!;
    await softDeleteReading(user.client, victim);
    const purged = await purgeReading(victim);
    expect(purged!.counts.period_summaries).toBe(1);
    const after = (
      await platformDb().select().from(periodSummaries).where(eq(periodSummaries.id, row.id))
    )[0]!;
    expect(after.sourceObjectIds).not.toContain(victim);
    expect(JSON.stringify(after.sources)).not.toContain(victim);
    expect(JSON.stringify(after.highlights)).not.toContain(victim);
    expect(after.staleAt).not.toBeNull();
    // Every remaining claim still has at least one citation, and claims that also cited
    // another entry survived with that citation (the scrub removes ids, not whole sections).
    const remaining = Object.values(
      after.highlights as Record<string, { citations: { id: string }[] }[]>,
    ).flat();
    for (const c of remaining) expect(c.citations.length).toBeGreaterThan(0);
    const beforeClaims = Object.values(
      row.highlights as Record<string, { citations: { id: string }[] }[]>,
    ).flat();
    const shouldSurvive = beforeClaims.filter((c) =>
      c.citations.some((x) => x.id !== victim),
    ).length;
    expect(remaining.length).toBe(shouldSurvive);
    // The narrative that rested on it lost it too.
    const narrative = (
      await platformDb()
        .select()
        .from(journeyNarratives)
        .where(eq(journeyNarratives.userId, user.id))
    )[0];
    if (narrative) expect(narrative.sourceObjectIds).not.toContain(victim);

    // Trigger path: a raw delete of the remaining sources, one by one, empties and removes the row.
    for (const id of after.sourceObjectIds) {
      const [r] = await platformDb().execute<{ id: string }>(
        sql`select id from public.readings where id = ${id}`,
      );
      if (r) await platformDb().execute(sql`delete from public.readings where id = ${id}`);
      else await platformDb().execute(sql`delete from public.life_events where id = ${id}`);
    }
    expect(
      await platformDb().select().from(periodSummaries).where(eq(periodSummaries.id, row.id)),
    ).toEqual([]);
    expect(
      await platformDb()
        .select()
        .from(retrievalDocuments)
        .where(eq(retrievalDocuments.objectId, row.id)),
    ).toEqual([]);
  });

  it('Home: one old reading a day, dismissal remembered, the switch stops it', async () => {
    const today = new Date();
    // Last month meets the monthly floor, so the look-back would take the slot first (by
    // priority); switching it off proves the switch and leaves the day's reading.
    await setRetentionSetting(user.client, user.id, 'retrospectives', false);
    await setRetentionSetting(user.client, user.id, 'journey_shifts', false);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * DAY);
    const old = await makeReading(user, refs, {
      question: 'Thirty days ago.',
      occurredAt: thirtyDaysAgo.toISOString(),
    });
    const other = await makeReading(user, refs, {
      question: 'Also thirty days ago.',
      occurredAt: new Date(thirtyDaysAgo.getTime() + 3600_000).toISOString(),
    });
    const first = await loadHomeInsight(user.client, user.id, { now: today });
    expect(first.insight?.kind).toBe('on_this_day');
    if (first.insight?.kind !== 'on_this_day') throw new Error('no resurfacing');
    expect([old.id, other.id]).toContain(first.insight.reading.id);
    const promptId = first.insight.promptId;
    // Shown again the same day: the same one, not the other (at most one per day).
    const again = await loadHomeInsight(user.client, user.id, { now: today });
    expect(again.insight).toMatchObject({ kind: 'on_this_day', promptId });
    expect(
      (await listRetentionPrompts(user.client)).filter((p) => p.kind === 'on_this_day'),
    ).toHaveLength(1);
    // Dismissed → gone, and stays gone.
    await dismissPrompt(user.client, promptId);
    expect((await loadHomeInsight(user.client, user.id, { now: today })).insight?.kind).not.toBe(
      'on_this_day',
    );
    // The switch: off means no candidate at all, on a later day too.
    await setRetentionSetting(user.client, user.id, 'on_this_day', false);
    expect(await getRetentionSettings(user.client)).toMatchObject({
      on_this_day: false,
      retrospectives: false,
      unresolved_review: true,
    });
    const later = await loadHomeInsight(user.client, user.id, {
      now: new Date(today.getTime() + DAY),
    });
    expect(later.insight?.kind).not.toBe('on_this_day');
    expect(
      await platformDb()
        .select()
        .from(retentionPrompts)
        .where(eq(retentionPrompts.userId, user.id)),
    ).toHaveLength(1);
  });

  it('covering summaries join an Ask package only for dropped entries, never dismissed or stale ones', async () => {
    // Build a fresh month with a summary, then ask for coverage of a date inside it.
    const month = periodContaining('monthly', new Date(TODAY.getTime() - 70 * DAY).toISOString());
    const day = (d: number) =>
      `${month.start.slice(0, 8)}${String(d).padStart(2, '0')}T12:00:00.000Z`;
    for (let i = 1; i <= 5; i++)
      await makeReading(user, refs, {
        question: `Question ${i} about the flat?`,
        occurredAt: day(i * 4),
      });
    const out = await generatePeriodSummary({ userId: user.id, kind: 'monthly', period: month });
    expect(out.status).toBe('generated');
    expect(await coveringSummaries(user.id, [])).toEqual([]);
    const covering = await coveringSummaries(user.id, [day(8).slice(0, 10), day(12).slice(0, 10)]);
    expect(covering).toHaveLength(1);
    expect(covering[0]).toMatchObject({ kind: 'monthly', periodKey: month.key, coversCount: 5 });
    expect(covering[0]!.claims.length).toBeGreaterThan(0);
    // A dropped date in a month without a summary covers nothing.
    expect(await coveringSummaries(user.id, ['2019-03-03'])).toEqual([]);
    // Dismissed or stale summaries never travel.
    const id = (out as { summaryId: string }).summaryId;
    await setSummaryDismissed(user.client, id, true);
    expect(await coveringSummaries(user.id, [day(8).slice(0, 10)])).toEqual([]);
  });
});
