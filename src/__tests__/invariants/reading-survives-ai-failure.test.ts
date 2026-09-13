import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider, type MockProvider } from '@/ai/providers/mock';
import { routingFromEnv } from '@/ai/registry';
import { createAiRunner, type AiRunner } from '@/ai/run';
import { mockSafety } from '@/ai/tasks/classify_safety/mock';
import { mockInterpretation } from '@/ai/tasks/interpret_reading/mock';
import { PROMPT_VERSION } from '@/ai/tasks/interpret_reading/version';
import { MemoryTelemetry } from '@/ai/telemetry';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import type { ServiceEvent } from '@/interpretation/events';
import { runInterpretation } from '@/interpretation/service';
import { memoryStore } from '@/__tests__/fixtures/memoryStore';
import { fixtureReading, FIXTURE_USER_ID } from '@/__tests__/fixtures/reading';

/**
 * Invariant (CLAUDE.md "writes are transactional before AI", spec §13): a reading is persisted
 * and usable even when every AI call fails. The interpretation service is run against an
 * in-memory store and the fault-injecting mock provider through every failure mode in
 * docs/AI_LAYER.md#failure-handling; after each, the reading — question, cards, orientations,
 * the user's note — is byte-for-byte what it was, and the interpretation row records the
 * failure honestly. The same run is repeated against Postgres in
 * `src/interpretation/__tests__/interpretation.integration.test.ts`.
 */

const routing = routingFromEnv({
  AI_MODEL_FAST: 'fast-model',
  AI_MODEL_STANDARD: 'standard-model',
  AI_MODEL_DEEP: 'deep-model',
  AI_EMBEDDING_MODEL: 'embed-model',
});

const profile = {
  id: FIXTURE_USER_ID,
  ai_consent_at: '2026-09-01T00:00:00.000Z',
  ai_explanation_depth: 'standard' as const,
  experience_level: null,
};

let mock: MockProvider;
let runner: AiRunner;
let telemetry: MemoryTelemetry;

beforeEach(() => {
  mock = createMockProvider({
    fixtures: {
      interpret_reading: { default: mockInterpretation },
      classify_safety: { default: mockSafety },
    },
  });
  telemetry = new MemoryTelemetry();
  runner = createAiRunner({
    provider: mock,
    routing,
    telemetry,
    sleep: async () => {},
    random: () => 0.5,
  });
});

async function run(opts: { deck?: typeof RWS_DECK; signal?: AbortSignal } = {}) {
  const reading = fixtureReading(
    opts.deck ?? RWS_DECK,
    opts.deck === THOTH_DECK
      ? ['lust', 'the-universe', 'princess-of-disks']
      : ['strength', 'the-tower', 'ace-of-cups'],
  );
  const snapshot = JSON.stringify(reading);
  const { store, rows, flags } = memoryStore();
  const events: ServiceEvent[] = [];
  for await (const e of runInterpretation({
    reading,
    profile,
    store,
    runner,
    signal: opts.signal,
    partialFlushMs: 0,
    timeoutMs: 30,
  })) {
    events.push(e);
  }
  return { reading, snapshot, rows, flags, events, last: events.at(-1)! };
}

describe('reading-survives-ai-failure', () => {
  it('the store the service writes through has no way to touch a reading', () => {
    const { store } = memoryStore();
    expect(Object.keys(store).sort()).toEqual([
      'complete',
      'createPending',
      'fail',
      'recordSafetyFlag',
      'updatePartial',
    ]);
    expect(JSON.stringify(Object.keys(store))).not.toMatch(/reading/i);
  });

  it('happy path: layered output persisted with versions; the reading unchanged', async () => {
    const r = await run();
    expect(r.last.type).toBe('complete');
    expect(JSON.stringify(r.reading)).toBe(r.snapshot);
    const row = r.rows[0]!;
    expect(row.status).toBe('complete');
    expect(row.prompt_version).toBe(PROMPT_VERSION);
    expect(row.schema_version).toBe('interpretation/1.0.0');
    expect(row.model_id).toBe('mock/deep-model');
    expect(row.metadata_version).toBe(1);
    expect(row.per_card).toHaveLength(3);
    expect((row.per_card as { card_id: string }[]).map((c) => c.card_id)).toEqual(
      r.reading.cards.map((c) => c.card.id),
    );
    expect(telemetry.records.map((t) => t.task)).toEqual(['classify_safety', 'interpret_reading']);
  });

  it.each([
    ['invalid JSON twice', () => mock.failWith('invalid_json', 2), 'invalid_output'],
    ['timeout → retry → downgrade → timeout', () => mock.failWith('timeout', 3), 'timeout'],
    ['429 three times', () => mock.failWith('429', 3), 'rate_limited'],
    ['5xx three times', () => mock.failWith('500', 3), 'server_error'],
    ['refusal', () => mock.failWith('refusal'), 'refusal'],
  ])('%s → failed(%s), reading intact', async (_name, inject, errorClass) => {
    // The safety classifier runs first and must succeed so the fault lands on interpretation.
    const safe = await runner.runObject({
      task: 'classify_safety',
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      schema: (await import('zod')).z.any(),
      maxTokens: 8,
    });
    expect(safe.ok).toBe(true);
    mock.reset();
    // classify_safety succeeds (no fault queued for it): queue faults after the first call.
    const origObject = mock.generateObject.bind(mock);
    let first = true;
    mock.generateObject = async (req, call) => {
      const res = await origObject(req, call);
      if (first) {
        first = false;
        inject();
      }
      return res;
    };
    const r = await run();
    expect(r.last).toMatchObject({ type: 'failed', errorClass });
    expect(JSON.stringify(r.reading)).toBe(r.snapshot);
    expect(r.rows[0]).toMatchObject({ status: 'failed', error_class: errorClass });
    expect(r.rows[0]!.fact_status).toBe('TAROT_INTERPRETATION');
    expect(String((r.last as { message: string }).message)).toMatch(/saved|still here|reference/i);
  });

  it('invalid JSON once → repair → complete (attempts 2)', async () => {
    let first = true;
    const origObject = mock.generateObject.bind(mock);
    mock.generateObject = async (req, call) => {
      const res = await origObject(req, call);
      if (first) {
        first = false;
        mock.failWith('invalid_json');
      }
      return res;
    };
    const r = await run();
    expect(r.events.some((e) => e.type === 'reset')).toBe(true);
    expect(r.last.type).toBe('complete');
    expect(telemetry.records.at(-1)).toMatchObject({
      task: 'interpret_reading',
      status: 'ok',
      attempts: 2,
    });
  });

  it('deck purity: a Thoth output with RWS vocabulary is repaired once, then fails as deck_purity', async () => {
    const impure = (req: { mockInput?: Record<string, unknown> }) => {
      const v = mockInterpretation({
        task: 'interpret_reading',
        system: '',
        messages: [],
        mockInput: req.mockInput,
      }) as { per_card: { text: string }[] };
      v.per_card[0]!.text =
        'The Page of Pentacles here suggests a slow, steady apprenticeship to the question.';
      return v;
    };
    const impureMock = createMockProvider({
      fixtures: {
        interpret_reading: { default: impure },
        classify_safety: { default: mockSafety },
      },
    });
    runner = createAiRunner({ provider: impureMock, routing, telemetry, sleep: async () => {} });
    const r = await run({ deck: THOTH_DECK });
    expect(r.last).toMatchObject({ type: 'failed', errorClass: 'deck_purity' });
    expect(impureMock.calls.filter((c) => c.kind === 'stream')).toHaveLength(2);
    expect(JSON.stringify(r.reading)).toBe(r.snapshot);
    expect(r.rows[0]).toMatchObject({ status: 'failed', error_class: 'deck_purity' });
  });

  it('budget denied: a clear message, no provider call, reading intact', async () => {
    runner = createAiRunner({
      provider: mock,
      routing,
      telemetry,
      budget: { check: async () => ({ allowed: false, reason: 'daily' }) },
    });
    const r = await run();
    expect(r.last).toMatchObject({ type: 'failed', errorClass: 'budget_denied' });
    expect((r.last as { message: string }).message).toMatch(/limit/);
    expect(mock.calls).toHaveLength(0);
    expect(JSON.stringify(r.reading)).toBe(r.snapshot);
    expect(r.rows[0]).toMatchObject({ status: 'failed', error_class: 'budget_denied' });
  });

  it('circuit open: short-circuits without a call and says so', async () => {
    for (let i = 0; i < 5; i++) runner.breaker.recordFailure();
    const r = await run();
    expect(r.last).toMatchObject({ type: 'failed', errorClass: 'circuit_open' });
    expect(mock.calls).toHaveLength(0);
    expect(JSON.stringify(r.reading)).toBe(r.snapshot);
  });

  it('no consent: no row, no call, honest message', async () => {
    const reading = fixtureReading(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const { store, rows } = memoryStore();
    const events: ServiceEvent[] = [];
    for await (const e of runInterpretation({
      reading,
      profile: { ...profile, ai_consent_at: null },
      store,
      runner,
    }))
      events.push(e);
    expect(events).toEqual([expect.objectContaining({ type: 'failed', errorClass: 'consent' })]);
    expect(rows).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('cancellation mid-stream keeps the partial layers and marks the row cancelled', async () => {
    const abort = new AbortController();
    const reading = fixtureReading(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const { store, rows } = memoryStore();
    const events: ServiceEvent[] = [];
    let texts = 0;
    for await (const e of runInterpretation({
      reading,
      profile,
      store,
      runner,
      signal: abort.signal,
      partialFlushMs: 0,
    })) {
      events.push(e);
      if (e.type === 'text' && ++texts === 6) abort.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'failed', errorClass: 'cancelled' });
    expect(rows[0]).toMatchObject({ status: 'failed', error_class: 'cancelled' });
    expect(rows[0]!.synthesis).not.toBeNull();
  });

  it('a self-harm-adjacent question still gets a reading and records one flag', async () => {
    const reading = fixtureReading(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups'], {
      question: 'Some days I want to end my life. Will it get better?',
    });
    const { store, rows, flags } = memoryStore();
    const events: ServiceEvent[] = [];
    for await (const e of runInterpretation({ reading, profile, store, runner })) events.push(e);
    expect(events.find((e) => e.type === 'safety')).toMatchObject({
      category: 'self_harm',
      severity: 'high',
    });
    expect(events.at(-1)?.type).toBe('complete');
    expect(rows[0]?.status).toBe('complete');
    expect(flags).toHaveLength(1);
    expect(JSON.stringify(flags[0])).not.toContain('end my life');
  });
});
