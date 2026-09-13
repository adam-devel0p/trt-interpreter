import { z } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider, type MockProvider } from '../providers/mock';
import { routingFromEnv } from '../registry';
import { createAiRunner, type AiRunner } from '../run';
import { MemoryTelemetry, type BudgetPolicy } from '../telemetry';
import type { ObjectRequest } from '../types';

const routing = routingFromEnv({
  AI_MODEL_FAST: 'fast-model',
  AI_MODEL_STANDARD: 'standard-model',
  AI_MODEL_DEEP: 'deep-model',
  AI_EMBEDDING_MODEL: 'embed-model',
});

const schema = z.object({ category: z.string(), severity: z.number() });
type Out = z.infer<typeof schema>;

function req(overrides: Partial<ObjectRequest<Out>> = {}): ObjectRequest<Out> {
  return {
    task: 'classify_safety',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    schema,
    maxTokens: 256,
    timeoutMs: 20,
    userId: 'user-1',
    objectRefs: [{ type: 'reading', id: 'r1' }],
    ...overrides,
  };
}

let mock: MockProvider;
let telemetry: MemoryTelemetry;
let runner: AiRunner;
let sleeps: number[];

beforeEach(() => {
  mock = createMockProvider({
    fixtures: { classify_safety: { default: { category: 'none', severity: 0 } } },
  });
  telemetry = new MemoryTelemetry();
  sleeps = [];
  runner = createAiRunner({
    provider: mock,
    routing,
    telemetry,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
});

describe('runObject — happy path', () => {
  it('resolves the tier from the registry, validates, records telemetry', async () => {
    const r = await runner.runObject(req());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ category: 'none', severity: 0 });
    expect(r.meta.modelId).toBe('mock/fast-model');
    expect(r.meta.repaired).toBe(false);
    expect(r.attempts).toBe(1);
    expect(mock.calls[0]?.tier).toBe('fast');
    expect(telemetry.records).toHaveLength(1);
    expect(telemetry.records[0]).toMatchObject({
      task: 'classify_safety',
      status: 'ok',
      userId: 'user-1',
      attempts: 1,
      objectRefs: [{ type: 'reading', id: 'r1' }],
    });
  });

  it('honours modelHint over the registry tier', async () => {
    const r = await runner.runObject(req({ modelHint: 'deep' }));
    expect(r.ok && r.meta.modelId).toBe('mock/deep-model');
  });
});

describe('runObject — invalid output', () => {
  it('invalid JSON → one repair attempt with the schema echoed → success', async () => {
    mock.failWith('invalid_json');
    const r = await runner.runObject(req());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.repaired).toBe(true);
    expect(r.attempts).toBe(2);
    expect(mock.calls).toHaveLength(2);
    // The repair turn appended one message; the original had one.
    expect(mock.calls[1]?.messageCount).toBe(2);
  });

  it('second invalid output → soft fail invalid_output', async () => {
    mock.failWith('invalid_json', 2);
    const r = await runner.runObject(req());
    expect(r).toMatchObject({ ok: false, status: 'invalid_output', attempts: 2 });
    expect(telemetry.records[0]?.status).toBe('invalid_output');
  });

  it('schema mismatch from a well-formed response is treated as invalid output', async () => {
    mock.respondWith({ category: 'x' }); // missing severity
    mock.respondWith({ category: 'x', severity: 1 });
    const r = await runner.runObject(req());
    expect(r.ok).toBe(true);
    expect(r.ok && r.meta.repaired).toBe(true);
  });
});

describe('runObject — timeout', () => {
  it('timeout → retry same tier → downgrade one tier → soft fail', async () => {
    mock.failWith('timeout', 3);
    const r = await runner.runObject(req({ modelHint: 'deep', timeoutMs: 10 }));
    expect(r).toMatchObject({ ok: false, status: 'timeout', errorClass: 'timeout', attempts: 3 });
    expect(mock.calls.map((c) => c.tier)).toEqual(['deep', 'deep', 'standard']);
  });

  it('a downgraded attempt can succeed', async () => {
    mock.failWith('timeout', 2);
    const r = await runner.runObject(req({ modelHint: 'standard', timeoutMs: 10 }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.meta.modelId).toBe('mock/fast-model');
    expect(mock.calls.map((c) => c.tier)).toEqual(['standard', 'standard', 'fast']);
  });

  it('at the fast tier there is nothing to downgrade to: retry once then fail', async () => {
    mock.failWith('timeout', 2);
    const r = await runner.runObject(req({ timeoutMs: 10 }));
    expect(r).toMatchObject({ ok: false, status: 'timeout', attempts: 2 });
  });
});

describe('runObject — 429 / 5xx', () => {
  it('429 → exponential backoff with jitter → success', async () => {
    mock.failWith('429', 2);
    const r = await runner.runObject(req());
    expect(r.ok).toBe(true);
    expect(r.ok && r.attempts).toBe(3);
    expect(sleeps).toEqual([750, 1500]); // 500*2^n * (0.5 + 0.5*0.5)
  });

  it('three rate-limit failures → soft fail provider_error', async () => {
    mock.failWith('500', 3);
    const r = await runner.runObject(req());
    expect(r).toMatchObject({
      ok: false,
      status: 'provider_error',
      errorClass: 'server_error',
      attempts: 3,
    });
  });

  it('circuit breaker opens after 5 consecutive failures and short-circuits the next run', async () => {
    mock.failWith('429', 5);
    const first = await runner.runObject(req()); // 3 failures
    expect(first).toMatchObject({ ok: false, status: 'provider_error' });
    expect(runner.breaker.failures).toBe(3);
    const second = await runner.runObject(req()); // 2 more → 5 → open
    expect(second).toMatchObject({ ok: false, errorClass: 'circuit_open' });
    expect(runner.breaker.isOpen()).toBe(true);
    const callsBefore = mock.calls.length;
    const third = await runner.runObject(req());
    expect(third).toMatchObject({
      ok: false,
      status: 'provider_error',
      errorClass: 'circuit_open',
      attempts: 0,
    });
    expect(mock.calls.length).toBe(callsBefore); // no provider call while open
    expect(telemetry.records.at(-1)?.errorClass).toBe('circuit_open');
  });

  it('a success resets the breaker', async () => {
    mock.failWith('429', 2);
    await runner.runObject(req());
    expect(runner.breaker.failures).toBe(0);
  });
});

describe('runObject — refusal and budget', () => {
  it('refusal is terminal and honest', async () => {
    mock.failWith('refusal');
    const r = await runner.runObject(req());
    expect(r).toMatchObject({ ok: false, status: 'refusal', errorClass: 'refusal', attempts: 1 });
    expect(mock.calls).toHaveLength(1);
  });

  it('budget denial happens before any provider call', async () => {
    const budget: BudgetPolicy = { check: async () => ({ allowed: false, reason: 'daily' }) };
    const r2 = createAiRunner({ provider: mock, routing, telemetry, budget });
    const r = await r2.runObject(req());
    expect(r).toMatchObject({ ok: false, status: 'budget_denied', attempts: 0 });
    expect(mock.calls).toHaveLength(0);
    expect(telemetry.records[0]?.status).toBe('budget_denied');
  });
});

describe('runStream', () => {
  it('streams text chunks then done, and records telemetry', async () => {
    const chunks = [];
    for await (const c of runner.runStream({
      task: 'interpret_reading',
      system: 's',
      messages: [],
      maxTokens: 10,
      fixture: 'default',
    }))
      chunks.push(c);
    expect(chunks.at(-1)?.type).toBe('done');
    expect(chunks.filter((c) => c.type === 'text').length).toBeGreaterThan(0);
    expect(telemetry.records[0]).toMatchObject({ task: 'interpret_reading', status: 'ok' });
  });

  it('yields an error chunk on refusal', async () => {
    mock.failWith('refusal');
    const chunks = [];
    for await (const c of runner.runStream({
      task: 'interpret_reading',
      system: 's',
      messages: [],
      maxTokens: 10,
    }))
      chunks.push(c);
    expect(chunks).toEqual([{ type: 'error', errorClass: 'refusal' }]);
    expect(telemetry.records[0]?.status).toBe('refusal');
  });
});
