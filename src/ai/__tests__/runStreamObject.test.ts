import { z } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider, type MockProvider } from '../providers/mock';
import { routingFromEnv } from '../registry';
import {
  createAiRunner,
  type AiRunner,
  type StreamObjectEvent,
  type StreamObjectRequest,
} from '../run';
import { MemoryTelemetry, type BudgetPolicy } from '../telemetry';

const routing = routingFromEnv({
  AI_MODEL_FAST: 'fast-model',
  AI_MODEL_STANDARD: 'standard-model',
  AI_MODEL_DEEP: 'deep-model',
  AI_EMBEDDING_MODEL: 'embed-model',
});

const schema = z.object({ synthesis: z.string(), items: z.array(z.string()) }).strict();
type Out = z.infer<typeof schema>;
const GOOD: Out = { synthesis: 'One line.', items: ['a', 'b'] };

function req(over: Partial<StreamObjectRequest<Out>> = {}): StreamObjectRequest<Out> {
  return {
    task: 'interpret_reading',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    schema,
    maxTokens: 256,
    timeoutMs: 20,
    userId: 'user-1',
    objectRefs: [{ type: 'reading', id: 'r1' }],
    ...over,
  };
}

async function collect(it: AsyncIterable<StreamObjectEvent<Out>>) {
  const events: StreamObjectEvent<Out>[] = [];
  for await (const e of it) events.push(e);
  const last = events.at(-1)!;
  const text = events
    .filter((e) => e.type === 'text')
    .map((e) => (e as { text: string }).text)
    .join('');
  return { events, last, text };
}

let mock: MockProvider;
let telemetry: MemoryTelemetry;
let runner: AiRunner;
let sleeps: number[];

beforeEach(() => {
  mock = createMockProvider({ fixtures: { interpret_reading: { default: GOOD } } });
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

describe('runStreamObject — the streaming face of the same policy', () => {
  it('streams text deltas, then the validated object and one telemetry row', async () => {
    const { events, last, text } = await collect(runner.runStreamObject(req()));
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1);
    expect(JSON.parse(text)).toEqual(GOOD);
    expect(last).toMatchObject({ type: 'done', value: GOOD, attempts: 1 });
    expect(last.type === 'done' && last.meta.modelId).toBe('mock/deep-model');
    expect(telemetry.records).toHaveLength(1);
    expect(telemetry.records[0]).toMatchObject({
      status: 'ok',
      task: 'interpret_reading',
      attempts: 1,
    });
  });

  it('invalid JSON → reset → repair turn → success (repaired flag set)', async () => {
    mock.failWith('invalid_json');
    const { events, last } = await collect(runner.runStreamObject(req()));
    expect(events.some((e) => e.type === 'reset' && e.reason === 'repair')).toBe(true);
    expect(last).toMatchObject({ type: 'done', attempts: 2 });
    expect(last.type === 'done' && last.meta.repaired).toBe(true);
    // The repair turn carries the failed attempt and the schema echo.
    expect(mock.calls[1]?.messageCount).toBe(3);
  });

  it('a second invalid output fails soft with the issue labels', async () => {
    mock.failWith('invalid_json', 2);
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({
      type: 'failed',
      status: 'invalid_output',
      errorClass: 'invalid_output',
      attempts: 2,
    });
    expect(telemetry.records[0]).toMatchObject({ status: 'invalid_output' });
  });

  it('a validator failure counts as invalid output: one repair with the hint, then success', async () => {
    mock.respondWith({ synthesis: 'The Page of Pentacles…', items: [] });
    const hints: string[] = [];
    const { events, last } = await collect(
      runner.runStreamObject(
        req({
          validate: (v) => (/pentacles/i.test(v.synthesis) ? ['deck_purity:pentacles'] : []),
          repairHint: (issues) => {
            hints.push(...issues);
            return 'Use only this deck’s names.';
          },
        }),
      ),
    );
    expect(hints).toEqual(['deck_purity:pentacles']);
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(1);
    expect(last).toMatchObject({ type: 'done', value: GOOD, attempts: 2 });
  });

  it('two validator failures → failed with the issues carried through', async () => {
    mock.respondWith({ synthesis: 'Pentacles', items: [] });
    mock.respondWith({ synthesis: 'Pentacles again', items: [] });
    const { last } = await collect(
      runner.runStreamObject(
        req({ validate: (v) => (/pentacles/i.test(v.synthesis) ? ['deck_purity:pentacles'] : []) }),
      ),
    );
    expect(last).toMatchObject({
      type: 'failed',
      status: 'invalid_output',
      issues: ['deck_purity:pentacles'],
    });
  });

  it('timeout → retry at the same tier → downgrade → soft fail', async () => {
    mock.failWith('timeout', 3);
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({ type: 'failed', status: 'timeout', attempts: 3 });
    expect(mock.calls.map((c) => c.tier)).toEqual(['deep', 'deep', 'standard']);
  });

  it('a downgraded attempt can succeed', async () => {
    mock.failWith('timeout', 2);
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({ type: 'done', attempts: 3 });
    expect(last.type === 'done' && last.meta.modelId).toBe('mock/standard-model');
  });

  it('429 → backoff with jitter → success; three in a row → provider_error', async () => {
    mock.failWith('429', 2);
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({ type: 'done', attempts: 3 });
    expect(sleeps).toEqual([750, 1500]);

    mock.reset();
    sleeps.length = 0;
    mock.failWith('500', 3);
    const again = await collect(runner.runStreamObject(req()));
    expect(again.last).toMatchObject({
      type: 'failed',
      status: 'provider_error',
      errorClass: 'server_error',
      attempts: 3,
    });
  });

  it('the breaker opens after five consecutive failures and short-circuits with no call', async () => {
    mock.failWith('500', 6);
    await collect(runner.runStreamObject(req()));
    await collect(runner.runStreamObject(req()));
    expect(runner.breaker.isOpen()).toBe(true);
    const callsBefore = mock.calls.length;
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({
      type: 'failed',
      status: 'provider_error',
      errorClass: 'circuit_open',
      attempts: 0,
    });
    expect(mock.calls.length).toBe(callsBefore);
  });

  it('refusal is terminal and honest', async () => {
    mock.failWith('refusal');
    const { last } = await collect(runner.runStreamObject(req()));
    expect(last).toMatchObject({
      type: 'failed',
      status: 'refusal',
      errorClass: 'refusal',
      attempts: 1,
    });
  });

  it('budget denial happens before any call', async () => {
    const budget: BudgetPolicy = { check: async () => ({ allowed: false, reason: 'daily' }) };
    const r = createAiRunner({ provider: mock, routing, telemetry, budget });
    const { last } = await collect(r.runStreamObject(req()));
    expect(last).toMatchObject({ type: 'failed', status: 'budget_denied', attempts: 0 });
    expect(mock.calls).toHaveLength(0);
    expect(telemetry.records[0]).toMatchObject({ status: 'budget_denied' });
  });

  it('stopping the consumer stops the provider and records nothing further', async () => {
    const it = runner.runStreamObject(req())[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value?.type).toBe('text');
    await it.return?.(undefined);
    expect(telemetry.records).toHaveLength(0);
  });
});
