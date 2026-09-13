import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider, type MockProvider } from '@/ai/providers/mock';
import { routingFromEnv } from '@/ai/registry';
import { createAiRunner, type AiRunner } from '@/ai/run';
import { mockSafety } from '@/ai/tasks/classify_safety/mock';
import { mockInterpretation } from '@/ai/tasks/interpret_reading/mock';
import { PROMPT_VERSION } from '@/ai/tasks/interpret_reading/version';
import { DbTelemetry } from '@/ai/telemetry';
import { closeAdmin, platformSql, recentAiCalls } from '@/db/admin';
import {
  getDeckBySlug,
  listCards,
  listSpreads,
  type DeckRow,
  type SpreadView,
} from '@/db/queries/decks';
import {
  getInterpretation,
  getInterpretationState,
  linkQuestionAsk,
  listRecentQuestionAsks,
  listSafetyFlags,
  setInterpretationFeedback,
} from '@/db/queries/interpretations';
import { getProfile, setAiConsent } from '@/db/queries/profile';
import { createReading, getReading } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import type { CreateReadingInput } from '@/domain/readings/types';
import type { ServiceEvent } from '@/interpretation/events';
import { checkRepeatQuestion } from '@/interpretation/repeat';
import { runInterpretation } from '@/interpretation/service';
import { dbStore } from '@/interpretation/store';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * The interpretation loop against Postgres with the mock provider: persistence of the layered
 * output with versions, `ai_calls` rows without content, regeneration that supersedes, the
 * frozen-when-complete trigger, the fact_status constraint, failure modes leaving the reading
 * intact, safety flags, feedback, and the repeated-question path through pgvector.
 */
const routing = routingFromEnv({
  AI_MODEL_FAST: 'mock-fast',
  AI_MODEL_STANDARD: 'mock-standard',
  AI_MODEL_DEEP: 'mock-deep',
  AI_EMBEDDING_MODEL: 'mock-embed',
});

describe('interpretation (integration)', () => {
  let user: TestUser;
  let rws: DeckRow;
  let thoth: DeckRow;
  let rwsIds: string[];
  let thothIds: string[];
  let spreads: SpreadView[];
  let mock: MockProvider;
  let runner: AiRunner;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('interp');
    await setAiConsent(user.client, user.id, true);
    rws = (await getDeckBySlug(user.client, 'rws-classic'))!;
    thoth = (await getDeckBySlug(user.client, 'thoth'))!;
    rwsIds = (await listCards(user.client, rws)).map((c) => c.id);
    thothIds = (await listCards(user.client, thoth)).map((c) => c.id);
    spreads = await listSpreads(user.client);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });
  beforeEach(() => {
    mock = createMockProvider({
      fixtures: {
        interpret_reading: { default: mockInterpretation },
        classify_safety: { default: mockSafety },
      },
    });
    runner = createAiRunner({
      provider: mock,
      routing,
      telemetry: new DbTelemetry(),
      sleep: async () => {},
    });
  });

  const spread = (slug: string) => spreads.find((s) => s.slug === slug)!;

  async function newReading(over: Partial<CreateReadingInput> = {}) {
    const input: CreateReadingInput = {
      question: 'Should I take the job in Lisbon?',
      is_open_reflection: false,
      life_area: 'work',
      spread_id: spread('three-card').id,
      deck_id: rws.id,
      source: 'physical',
      uses_reversals: true,
      cards: [
        { position_index: 0, card_id: rwsIds[7]!, orientation: 'upright' },
        { position_index: 1, card_id: rwsIds[16]!, orientation: 'reversed' },
        { position_index: 2, card_id: rwsIds[36]!, orientation: 'upright' },
      ],
      user_notes: 'The Tower again. I keep drawing it when I think about money.',
      occurred_at: null,
      rng: null,
      ...over,
    };
    const id = await createReading(user.client, input);
    return (await getReading(user.client, id))!;
  }

  async function run(readingId: string, opts: { timeoutMs?: number } = {}) {
    const reading = (await getReading(user.client, readingId))!;
    const profile = (await getProfile(user.client, user.id))!;
    const events: ServiceEvent[] = [];
    for await (const e of runInterpretation({
      reading,
      profile,
      store: dbStore(user.client),
      runner,
      partialFlushMs: 0,
      timeoutMs: opts.timeoutMs,
    })) {
      events.push(e);
    }
    return { events, last: events.at(-1)! };
  }

  it('happy path: layered output persisted with model/prompt/schema versions; ai_calls has rows and no content', async () => {
    const reading = await newReading();
    const before = JSON.stringify(reading);
    const { events, last } = await run(reading.id);
    expect(events[0]).toMatchObject({ type: 'started' });
    expect(last.type).toBe('complete');
    const state = await getInterpretationState(user.client, reading.id);
    expect(state.current).not.toBeNull();
    expect(state.current).toMatchObject({
      status: 'complete',
      fact_status: 'TAROT_INTERPRETATION',
      model_id: 'mock/mock-deep',
      prompt_version: PROMPT_VERSION,
      schema_version: 'interpretation/1.0.0',
      metadata_version: 1,
      depth: 'standard',
      error_class: null,
    });
    expect(state.current!.per_card.map((c) => c.card_id)).toEqual(
      reading.cards.map((c) => c.card.id),
    );
    expect(state.current!.reflective_prompts.length).toBeGreaterThanOrEqual(2);
    expect(state.current!.tokens_in).toBeGreaterThan(0);
    expect(JSON.stringify((await getReading(user.client, reading.id))!)).toBe(before);

    const calls = (await recentAiCalls(10)).filter((c) =>
      (c.objectRefs as { id: string }[]).some((o) => o.id === reading.id),
    );
    expect(calls.map((c) => c.task).sort()).toEqual(['classify_safety', 'interpret_reading']);
    for (const c of calls) {
      const row = JSON.stringify(c);
      expect(c.status).toBe('ok');
      expect(row).not.toContain('Lisbon');
      expect(row).not.toContain('Tower again');
      expect(row).not.toContain(state.current!.synthesis.slice(0, 20));
      // No prose anywhere: every string value is an identifier, a version or a timestamp.
      const strings = Object.values(c).flatMap((v) =>
        typeof v === 'string'
          ? [v]
          : Array.isArray(v)
            ? v.flatMap((o) => Object.values(o as object).map(String))
            : [],
      );
      for (const v of strings) expect(v, v).toMatch(/^[\w\-./:+@]+$/);
    }
  });

  it('a complete row is frozen; regeneration supersedes and keeps the old row; one current per reading', async () => {
    const reading = await newReading();
    await run(reading.id);
    const first = (await getInterpretationState(user.client, reading.id)).current!;
    const frozen = await user.client
      .from('interpretations')
      .update({ synthesis: 'tampered' })
      .eq('id', first.id);
    expect(frozen.error?.code).toBe('23514');
    // A second complete current row is refused by the partial unique index.
    const dup = await user.client.from('interpretations').insert({
      reading_id: reading.id,
      user_id: user.id,
      status: 'complete',
      metadata_version: 1,
      depth: 'standard',
      synthesis: 's',
      per_card: [],
      combined: 'c',
      reflective_prompts: ['p'],
      model_id: 'm',
      prompt_version: 'p',
      schema_version: 's',
    });
    expect(dup.error?.code).toBe('23505');

    await run(reading.id);
    const state = await getInterpretationState(user.client, reading.id);
    expect(state.current!.id).not.toBe(first.id);
    const old = (await getInterpretation(user.client, first.id))!;
    expect(old.status).toBe('complete');
    expect(old.superseded_by).toBe(state.current!.id);
    expect(old.synthesis).toBe(first.synthesis);
  });

  it('the fact_status check constraint refuses anything but TAROT_INTERPRETATION (invariant 7)', async () => {
    const reading = await newReading();
    for (const fact_status of ['CONFIRMED_FACT', 'USER_REFLECTION', 'INFERRED_EVENT']) {
      const res = await user.client.from('interpretations').insert({
        reading_id: reading.id,
        user_id: user.id,
        metadata_version: 1,
        depth: 'standard',
        prompt_version: 'p',
        schema_version: 's',
        fact_status,
      });
      expect(res.error?.code, fact_status).toBe('23514');
    }
  });

  it.each([
    ['invalid JSON twice', 'invalid_json', 2, 'invalid_output'],
    ['refusal', 'refusal', 1, 'refusal'],
    ['timeout ×3', 'timeout', 3, 'timeout'],
  ] as const)(
    '%s → failed row, reading + cards + notes intact',
    async (_n, fault, times, errorClass) => {
      const reading = await newReading();
      const before = JSON.stringify(reading);
      const orig = mock.generateObject.bind(mock);
      let first = true;
      mock.generateObject = async (req, call) => {
        const res = await orig(req, call);
        if (first) {
          first = false;
          mock.failWith(fault, times);
        }
        return res;
      };
      const { last } = await run(reading.id, { timeoutMs: 30 });
      expect(last).toMatchObject({ type: 'failed', errorClass });
      const state = await getInterpretationState(user.client, reading.id);
      expect(state.current).toBeNull();
      expect(state.latest).toMatchObject({ status: 'failed', error_class: errorClass });
      expect(JSON.stringify((await getReading(user.client, reading.id))!)).toBe(before);
      const call = (await recentAiCalls(5)).find((c) => c.task === 'interpret_reading');
      expect(call?.status).toBe(
        errorClass === 'refusal'
          ? 'refusal'
          : errorClass === 'timeout'
            ? 'timeout'
            : 'invalid_output',
      );
    },
  );

  it('budget denied → failed row with a clear class, no interpret call, reading intact', async () => {
    runner = createAiRunner({
      provider: mock,
      routing,
      telemetry: new DbTelemetry(),
      budget: { check: async () => ({ allowed: false, reason: 'daily' }) },
    });
    const reading = await newReading();
    const { last } = await run(reading.id);
    expect(last).toMatchObject({ type: 'failed', errorClass: 'budget_denied' });
    expect(mock.calls).toHaveLength(0);
    expect((await getInterpretationState(user.client, reading.id)).latest).toMatchObject({
      status: 'failed',
      error_class: 'budget_denied',
    });
    expect((await getReading(user.client, reading.id))!.user_notes).toBe(
      'The Tower again. I keep drawing it when I think about money.',
    );
  });

  it('a self-harm-adjacent question still gets an interpretation and one content-free flag', async () => {
    const reading = await newReading({
      question: 'Some days I want to end my life. Will it get better?',
    });
    const { events, last } = await run(reading.id);
    expect(events.find((e) => e.type === 'safety')).toMatchObject({
      category: 'self_harm',
      severity: 'high',
    });
    expect(last.type).toBe('complete');
    const flags = await listSafetyFlags(user.client, 'reading', reading.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      category: 'self_harm',
      severity: 'high',
      resource_shown: 'self_harm',
    });
    expect(flags[0]!.surfaced_at).not.toBeNull();
    expect(JSON.stringify(flags)).not.toContain('end my life');
    // Running again does not duplicate the flag.
    await run(reading.id);
    expect(await listSafetyFlags(user.client, 'reading', reading.id)).toHaveLength(1);
    // A benign question records nothing.
    const benign = await newReading();
    await run(benign.id);
    expect(await listSafetyFlags(user.client, 'reading', benign.id)).toEqual([]);
  });

  it('Thoth reading: interpretation completes with no RWS vocabulary anywhere', async () => {
    const reading = await newReading({
      deck_id: thoth.id,
      uses_reversals: false,
      cards: [
        { position_index: 0, card_id: thothIds[11]!, orientation: 'upright' },
        { position_index: 1, card_id: thothIds[21]!, orientation: 'upright' },
        { position_index: 2, card_id: thothIds[77]!, orientation: 'upright' },
      ],
    });
    const { last } = await run(reading.id);
    expect(last.type).toBe('complete');
    const row = (await getInterpretationState(user.client, reading.id)).current!;
    expect(JSON.stringify(row)).not.toMatch(/Pentacles|\bPage\b|Rider/);
    expect(row.synthesis).toMatch(/Lust|Universe|Princess of Disks/);
  });

  it('feedback is a user write on the row; the reason is stored as the user typed it', async () => {
    const reading = await newReading();
    await run(reading.id);
    const row = (await getInterpretationState(user.client, reading.id)).current!;
    await setInterpretationFeedback(user.client, row.id, -1, 'Too general for my question.');
    const after = (await getInterpretation(user.client, row.id))!;
    expect(after.feedback).toBe(-1);
    expect(after.feedback_reason).toBe('Too general for my question.');
    expect(after.feedback_at).not.toBeNull();
    await setInterpretationFeedback(user.client, row.id, null, null);
    expect((await getInterpretation(user.client, row.id))!.feedback).toBeNull();
  });

  it('repeat question (FR-25): nudge on the third near-identical ask, not the second; once per day; linked on save', async () => {
    const embedder = {
      id: 'mock',
      embed: (r: Parameters<MockProvider['embed']>[0]) => mock.embed(r),
    };
    const q = 'Will Sam call me back tonight?';
    const ask = () =>
      checkRepeatQuestion({ client: user.client, userId: user.id, question: q, embedder });

    expect((await ask()).nudge).toBe(false);
    const r1 = await newReading({ question: q });
    expect(await linkQuestionAsk(user.client, user.id, q, r1.id)).toBe(true);

    expect((await ask()).nudge).toBe(false); // second ask: one prior reading
    const r2 = await newReading({ question: q });
    await linkQuestionAsk(user.client, user.id, q, r2.id);

    const third = await ask(); // third: two prior readings
    expect(third.nudge).toBe(true);
    expect(third.priorReadings.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
    expect(third.priorReadings[0]!.question).toBe(q);

    const r3 = await newReading({ question: q });
    await linkQuestionAsk(user.client, user.id, q, r3.id);
    const fourth = await ask(); // same cluster, same day: no second nudge
    expect(fourth.nudge).toBe(false);

    const other = await checkRepeatQuestion({
      client: user.client,
      userId: user.id,
      question: 'Should I repaint the kitchen?',
      embedder,
    });
    expect(other.nudge).toBe(false);

    const asks = await listRecentQuestionAsks(
      user.client,
      user.id,
      new Date(Date.now() - 3600_000),
    );
    expect(asks.length).toBe(5);
    expect(asks.every((a) => a.vector.length === 1536)).toBe(true);
    const [row] = await platformSql()<
      { n: number }[]
    >`select count(*)::int as n from public.question_embeddings where user_id = ${user.id} and reading_id is not null`;
    expect(row?.n).toBe(3);
  });
});
