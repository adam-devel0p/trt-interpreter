import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, resetAiForTests } from '@/ai';
import { closeAdmin, platformDb, recentAiCalls } from '@/db/admin';
import { jobs, journeyMembers, journeys, journeyThemeProgression, readings } from '@/db/schema';
import {
  acceptJourney,
  confirmMember,
  createJourney,
  dismissJourney,
  getJourney,
  getReadingJourneys,
  listJourneys,
  mergeJourneys,
  removeMember,
  renameJourney,
  splitJourney,
  undoJourneyMerge,
} from '@/db/queries/journeys';
import { searchJournal } from '@/db/queries/journal';
import { setAiConsent } from '@/db/queries/profile';
import { softDeleteReading } from '@/db/queries/readings';
import { EMPTY_FILTERS } from '@/domain/journal/filters';
import { seedReferenceData } from '@/db/seed/reference';
import { runBatch } from '@/jobs/worker';
import { runExtraction } from '@/memory/extract';
import { materializeReading } from '@/memory/materialize';
import { purgeReading } from '@/privacy/purge';
import { discoverJourneys } from '@/journeys/discover';
import { materializeJourneysForReading } from '@/journeys/materialize';
import { runProposeJourney } from '@/journeys/propose';
import { refreshJourney } from '@/journeys/refresh';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableExtraction, enableJourneys } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * Journeys against Postgres with the mock provider (spec §6.5, FR-10, FR-16, FR-17): the
 * assignment step runs as part of materialisation after extraction and creates a journey
 * at the documented thresholds; naming is a queued job whose proposal never overrides a
 * user's rename; merge moves members and dedupes, undo restores; split re-evaluates both
 * sides; a dismissed suggestion is not re-suggested until new evidence arrives; a removed
 * member is never re-added; evidence integrity survives a purge; the detail read is a fixed
 * number of queries whatever the member count.
 */
const DAY = 86_400_000;
// Recent dates (a journey idle for four months is rightly marked dormant), snapped to a Monday
// so that days 0 and 6 share a weekly progression bucket.
const T0 = (() => {
  const d = new Date(Date.now() - 45 * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
})();
const at = (day: number) => new Date(T0 + day * DAY).toISOString();

describe('journeys (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    getAiRunner();
    user = await createTestUser('journeys');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    await enableJourneys(user.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  const mayaReading = (
    day: number,
    question: string,
    notes: string,
    deck: 'rws' | 'thoth' = 'rws',
  ) =>
    makeReading(user, refs, {
      question,
      notes,
      occurredAt: at(day),
      deck,
      lifeArea: 'relationships',
    });

  const extract = async (id: string) => {
    const out = await runExtraction(id, { force: true });
    expect(out.status).toBe('complete');
  };

  const myJourneys = () => platformDb().select().from(journeys).where(eq(journeys.userId, user.id));

  it('creates an active journey from the third reading about the same person across two weeks, names it by job, and files the next reading', async () => {
    const r1 = await mayaReading(
      0,
      'How is it going with Maya?',
      'We keep circling the same distance. A conversation we are not having.',
    );
    const r2 = await mayaReading(
      6,
      'What does Maya need from me?',
      'Maya wants a conversation, not a plan. The distance again.',
      'thoth',
    );
    await extract(r1.id);
    await extract(r2.id);
    // Two readings: only a suggestion could form, and it needs the pair floor — here they
    // share an entity and both themes, so a suggested journey exists but nothing is active.
    let all = await myJourneys();
    expect(all.map((j) => j.status)).toEqual(['suggested']);

    const r3 = await mayaReading(
      14,
      'Should I talk to Maya about the distance?',
      'Talk about the distance. Say it.',
    );
    await extract(r3.id);
    all = await myJourneys();
    expect(all).toHaveLength(1);
    const j = all[0]!;
    expect(j.status).toBe('active');
    expect(j.createdBy).toBe('rule');
    expect(j.titleSource).toBe('rule');
    expect(j.title).toBe('Maya');
    expect(j.userConfirmed).toBe(false);
    expect(j.reasons).toContain('Every entry mentions Maya');
    const members = await platformDb()
      .select()
      .from(journeyMembers)
      .where(eq(journeyMembers.journeyId, j.id));
    expect(members.map((m) => m.state)).toEqual(['auto', 'auto', 'auto']);
    expect(members.every((m) => m.createdBy === 'rule')).toBe(true);

    // The naming job was queued (consent + flag), not run in the request; the cron names it.
    const queued = await platformDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, 'propose_journey'), eq(jobs.status, 'queued')));
    expect(queued.some((q) => (q.payload as { journeyId: string }).journeyId === j.id)).toBe(true);
    const batch = await runBatch({
      jobId: queued.find((q) => (q.payload as { journeyId: string }).journeyId === j.id)!.id,
    });
    expect(batch.succeeded).toBe(1);
    const [named] = await myJourneys();
    expect(named!.titleSource).toBe('model');
    expect(named!.title).toMatch(/^Maya and (distance|communication)$/);
    expect(named!.modelId).toBe('mock/claude-sonnet-5');
    expect(named!.promptVersion).toBe('propose_journey/1.0.0');
    expect(named!.schemaVersion).toBe('journey_proposal/1.0.0');
    expect(named!.rationale).toMatch(/names Maya/);
    const calls = await recentAiCalls(5);
    expect(calls.some((c) => c.task === 'propose_journey' && c.userId === user.id)).toBe(true);

    // A fourth reading that names Maya but shares no theme is asked about, not filed.
    const r4 = await mayaReading(20, 'Will Maya like the flat?', 'The flat viewing is on Friday.');
    await extract(r4.id);
    const rj = await getReadingJourneys(user.client, r4.id);
    expect(rj.memberships).toHaveLength(1);
    expect(rj.memberships[0]!.state).toBe('pending');
    expect(rj.memberships[0]!.reasons).toContain('Both mention Maya');
    // The detail keeps pending apart from the timeline; progression has evidence.
    const detail = (await getJourney(user.client, j.id))!;
    expect(detail.members.map((m) => m.reading.id).sort()).toEqual([r1.id, r2.id, r3.id].sort());
    expect(detail.pending.map((m) => m.reading.id)).toEqual([r4.id]);
    expect(detail.members.map((m) => m.reading.deck.system).sort()).toEqual([
      'rws',
      'rws',
      'thoth',
    ]);
    expect(detail.progression.length).toBeGreaterThanOrEqual(1);
    for (const s of detail.progression)
      expect(s.source_object_ids.length).toBeGreaterThanOrEqual(2);
    // Accept the question: confirmed, and the journal filter finds it.
    await confirmMember(user.client, rj.memberships[0]!.member_id);
    const page = await searchJournal(user.client, { ...EMPTY_FILTERS, journey: j.id });
    expect(page.items.map((i) => i.id).sort()).toEqual([r1.id, r2.id, r3.id, r4.id].sort());
  });

  it('a rename pins the title: a later proposal is skipped, and a proposal racing a rename loses', async () => {
    const [j] = await myJourneys();
    await renameJourney(user.client, j!.id, 'Me and Maya');
    expect((await runProposeJourney(j!.id)).status).toBe('skipped');
    const [after] = await myJourneys();
    expect(after!.title).toBe('Me and Maya');
    expect(after!.titleSource).toBe('user');
    expect(after!.userConfirmed).toBe(true);
    // Force the model path: a proposal computed before the rename cannot overwrite it.
    await platformDb().update(journeys).set({ titleSource: 'rule' }).where(eq(journeys.id, j!.id));
    const racing = getAiRunner();
    // Simulate the race: rename after the proposal has been requested but before it writes.
    const original = racing.runObject.bind(racing);
    const patched = {
      ...racing,
      runObject: async (req: Parameters<typeof original>[0]) => {
        const res = await original(req);
        await renameJourney(user.client, j!.id, 'Me and Maya, again');
        return res;
      },
    } as typeof racing;
    const out = await runProposeJourney(j!.id, { runner: patched });
    expect(out).toEqual({ status: 'kept', reason: 'renamed_meanwhile' });
    expect((await myJourneys())[0]!.title).toBe('Me and Maya, again');
  });

  it('merge moves members and dedupes; undo restores exactly; split re-evaluates both sides', async () => {
    const [target] = await myJourneys();
    const detail = (await getJourney(user.client, target!.id))!;
    const shared = detail.members[0]!.reading.id;
    const extra = await makeReading(user, refs, { question: 'Something else', occurredAt: at(40) });
    const source = await createJourney(user.client, user.id, 'Overlap', [shared, extra.id]);
    await mergeJourneys(user.client, source, target!.id);
    const merged = (await getJourney(user.client, target!.id))!;
    expect(merged.members.map((m) => m.reading.id)).toContain(extra.id);
    expect(merged.members.filter((m) => m.reading.id === shared)).toHaveLength(1);
    const src = (await getJourney(user.client, source))!;
    expect(src.journey.status).toBe('closed');
    expect(src.merged_into?.id).toBe(target!.id);
    expect(src.members).toEqual([]);
    await undoJourneyMerge(user.client, source);
    const restored = (await getJourney(user.client, source))!;
    expect(restored.journey.status).toBe('active');
    expect(restored.members.map((m) => m.reading.id).sort()).toEqual([shared, extra.id].sort());
    expect(
      (await getJourney(user.client, target!.id))!.members.map((m) => m.reading.id),
    ).not.toContain(extra.id);

    // Split: move one member off; both journeys are refreshed and the reading is untouched.
    const member = restored.members.find((m) => m.reading.id === extra.id)!;
    const newId = await splitJourney(user.client, source, 'Just the extra', [member.id]);
    await refreshJourney(newId);
    await refreshJourney(source);
    const split = (await getJourney(user.client, newId))!;
    expect(split.journey).toMatchObject({
      title: 'Just the extra',
      created_by: 'user',
      title_source: 'user',
      user_confirmed: true,
      status: 'active',
    });
    expect(split.members.map((m) => [m.reading.id, m.state])).toEqual([[extra.id, 'confirmed']]);
    expect((await getJourney(user.client, source))!.members.map((m) => m.reading.id)).toEqual([
      shared,
    ]);
    await expect(
      splitJourney(
        user.client,
        source,
        'all',
        (await getJourney(user.client, source))!.members.map((m) => m.id),
      ),
    ).rejects.toThrow();
    const [row] = await platformDb().select().from(readings).where(eq(readings.id, extra.id));
    expect(row!.deletedAt).toBeNull();
  });

  it('a removed member is never re-added by re-materialisation; undo puts it back', async () => {
    const [j] = (await listJourneys(user.client)).filter((x) => x.title.startsWith('Me and Maya'));
    const detail = (await getJourney(user.client, j!.id))!;
    const m = detail.members.find((x) => x.state === 'auto')!;
    const { previous } = await removeMember(user.client, m.id);
    expect(previous).toBe('auto');
    await materializeReading(m.reading.id);
    await materializeJourneysForReading(m.reading.id);
    const rows = await platformDb()
      .select()
      .from(journeyMembers)
      .where(and(eq(journeyMembers.journeyId, j!.id), eq(journeyMembers.objectId, m.reading.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('removed');
    expect((await getJourney(user.client, j!.id))!.members.map((x) => x.id)).not.toContain(m.id);
    const { restoreMember } = await import('@/db/queries/journeys');
    await restoreMember(user.client, m.id, previous);
    expect((await getJourney(user.client, j!.id))!.members.map((x) => x.id)).toContain(m.id);
  });

  it('a dismissed suggestion is not re-suggested; new evidence is; accepting makes it active', async () => {
    const a = await makeReading(user, refs, {
      question: 'What does the autumn hold for my health?',
      notes: 'Slow down; find a routine.',
      occurredAt: at(100),
      lifeArea: 'health',
    });
    const b = await makeReading(user, refs, {
      question: 'Will the new routine stick?',
      notes: 'Quiet confidence. Health first.',
      occurredAt: at(130),
      lifeArea: 'health',
    });
    await extract(a.id);
    await extract(b.id);
    const suggested = (await myJourneys()).filter(
      (j) => j.status === 'suggested' && !j.dismissedAt,
    );
    expect(suggested).toHaveLength(1);
    const s = suggested[0]!;
    expect(s.reasons).toContain('Only two entries so far — a guess, not a pattern');
    await dismissJourney(user.client, s.id);
    expect((await discoverJourneys(user.id)).created).toEqual([]);
    await materializeJourneysForReading(b.id);
    expect((await myJourneys()).filter((j) => j.status === 'suggested' && !j.dismissedAt)).toEqual(
      [],
    );
    // New evidence: a third health reading forms a new suggestion / journey.
    const c = await makeReading(user, refs, {
      question: 'How is my health holding up?',
      notes: 'The routine is holding. Steady.',
      occurredAt: at(150),
      lifeArea: 'health',
    });
    await extract(c.id);
    const again = (await myJourneys()).filter(
      (j) => j.status !== 'closed' && !j.dismissedAt && j.id !== s.id,
    );
    const fresh = again.find((j) => j.createdAt.getTime() > s.createdAt.getTime());
    expect(fresh, 'a cluster with new evidence is offered').toBeTruthy();
    await acceptJourney(user.client, fresh!.id);
    const accepted = (await getJourney(user.client, fresh!.id))!;
    expect(accepted.journey.status).toBe('active');
    expect(accepted.journey.accepted_at).not.toBeNull();
    expect(accepted.journey.user_confirmed).toBe(true);
  });

  it('purging a member reading removes the membership and re-derives the evidence', async () => {
    const [j] = (await listJourneys(user.client)).filter((x) => x.title.startsWith('Me and Maya'));
    const before = (await getJourney(user.client, j!.id))!;
    const victim = before.members[before.members.length - 1]!;
    const step = before.progression.find((s) => s.source_object_ids.includes(victim.reading.id));
    await softDeleteReading(user.client, victim.reading.id);
    // Soft-deleted: out of every view before the purge runs.
    expect((await getJourney(user.client, j!.id))!.members.map((m) => m.reading.id)).not.toContain(
      victim.reading.id,
    );
    const res = await purgeReading(victim.reading.id);
    expect(res?.counts.journey_members).toBeGreaterThanOrEqual(1);
    const after = (await getJourney(user.client, j!.id))!;
    for (const s of after.progression) expect(s.source_object_ids).not.toContain(victim.reading.id);
    if (step) expect(after.progression.find((s) => s.id === step.id)).toBeUndefined();
    const rows = await platformDb()
      .select()
      .from(journeyThemeProgression)
      .where(eq(journeyThemeProgression.journeyId, j!.id));
    for (const r of rows) expect(r.sourceObjectIds).not.toContain(victim.reading.id);
  });

  it('a 100-member journey reads in a fixed number of queries', async () => {
    const big = await createJourney(user.client, user.id, 'Big');
    const ids: string[] = [];
    for (let i = 0; i < 100; i++)
      ids.push(
        (
          await makeReading(user, refs, {
            question: `Reading ${i}`,
            occurredAt: at(200 + i),
            deck: i % 2 ? 'thoth' : 'rws',
          })
        ).id,
      );
    const { addReadingToJourney } = await import('@/db/queries/journeys');
    for (const id of ids) await addReadingToJourney(user.client, user.id, big, id);
    await refreshJourney(big);
    let requests = 0;
    const counting = new Proxy(user.client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === 'from' || prop === 'rpc')
          return (...args: unknown[]) => {
            requests += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const started = Date.now();
    const detail = (await getJourney(counting, big))!;
    const ms = Date.now() - started;
    expect(detail.members).toHaveLength(100);
    expect(requests).toBeLessThanOrEqual(5);
    expect(ms).toBeLessThan(5_000);
    // Every card keeps its own deck's name: Thoth members render Thoth names, RWS ones RWS.
    for (const m of detail.members)
      for (const c of m.reading.cards) expect(c.card.deck_system).toBe(m.reading.deck.system);
  }, 120_000);
});
