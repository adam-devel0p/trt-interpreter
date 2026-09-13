/**
 * Deterministic mock provider. Canned responses keyed by task + fixture name, plus fault
 * injection so every branch of run.ts is testable without a network.
 */
import { AiProviderError, isProviderError, type AiProvider } from '../provider';
import type {
  EmbedRequest,
  EmbedResult,
  ObjectRequest,
  ObjectResult,
  ResolvedCall,
  ResultMeta,
  StreamChunk,
  StreamRequest,
  TaskId,
} from '../types';

export type MockFault = 'timeout' | 'invalid_json' | 'refusal' | '429' | '500';

/**
 * A fixture is a canned value, or a function that fabricates one from the request's
 * `mockInput` hints (so the mock can answer for any reading without a model).
 */
export type FixtureValue = unknown | ((req: FixtureRequest) => unknown);
export interface FixtureRequest {
  task: TaskId;
  system: string;
  messages: { role: string; content: string }[];
  mockInput?: Record<string, unknown>;
}
export type FixtureTable = Partial<Record<TaskId, Record<string, FixtureValue>>>;

export interface MockCall {
  kind: 'object' | 'stream' | 'embed';
  task: TaskId;
  modelId?: string;
  tier?: string;
  messageCount?: number;
  fixture?: string;
}

export interface MockProvider extends AiProvider {
  /** Queue a fault for the next `times` calls (FIFO across both object and stream calls). */
  failWith(fault: MockFault, times?: number): void;
  /** Queue an explicit value for the next object call (takes precedence over fixtures). */
  respondWith(value: unknown): void;
  /** Every call made, in order, content-free. */
  readonly calls: MockCall[];
  reset(): void;
}

export interface MockOptions {
  fixtures?: FixtureTable;
  /** Simulated latency; 0 in tests. */
  latencyMs?: number;
}

/** Reported as `mock/<routed id>` so a stored row never claims a real model ran. */
function meta(modelId: string, latencyMs: number, repaired = false): ResultMeta {
  return {
    modelId: `mock/${modelId}`,
    promptVersion: 'mock-1',
    schemaVersion: 'mock-1',
    tokensIn: 100,
    tokensOut: 50,
    costMicros: 0,
    latencyMs,
    repaired,
  };
}

export const MOCK_EMBEDDING_DIMENSIONS = 1536;

/**
 * Deterministic hashed bag-of-words embedding, unit length, same dimensionality as the real
 * model. Identical questions score 1.0, paraphrases share most words, unrelated questions score
 * low — enough for the repeat-question rule to be tested without a network.
 */
export function mockEmbedding(text: string): number[] {
  const v = new Array<number>(MOCK_EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    const idx = Math.abs(h) % MOCK_EMBEDDING_DIMENSIONS;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Rejects only when the caller aborts (run.ts's timeout), like a hung network call. */
function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new AiProviderError('timeout'));
    signal.addEventListener('abort', () => reject(new AiProviderError('timeout')), { once: true });
  });
}

export function createMockProvider(opts: MockOptions = {}): MockProvider {
  const faults: MockFault[] = [];
  const responses: unknown[] = [];
  const calls: MockCall[] = [];
  const latencyMs = opts.latencyMs ?? 0;
  const fixtures = opts.fixtures ?? {};

  async function applyFault(signal: AbortSignal): Promise<void> {
    const fault = faults.shift();
    if (!fault) return;
    switch (fault) {
      case 'timeout':
        return hangUntilAborted(signal);
      case 'invalid_json':
        throw new AiProviderError('invalid_output', 'mock: unparseable');
      case 'refusal':
        throw new AiProviderError('refusal');
      case '429':
        throw new AiProviderError('rate_limited', '429');
      case '500':
        throw new AiProviderError('server_error', '500');
    }
  }

  function lookupFixture(req: FixtureRequest & { fixture?: string }): unknown {
    if (responses.length > 0) return responses.shift();
    const table = fixtures[req.task];
    const name = req.fixture ?? 'default';
    if (table && name in table) {
      const v = table[name];
      return typeof v === 'function' ? (v as (r: FixtureRequest) => unknown)(req) : v;
    }
    throw new AiProviderError('invalid_output', `mock: no fixture ${req.task}/${name}`);
  }

  /** Split a string into streaming-sized pieces so partial parsing is exercised. */
  function* pieces(text: string, size = 14): Generator<string> {
    for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
  }

  const provider: MockProvider = {
    id: 'mock',
    calls,
    failWith(fault, times = 1) {
      for (let i = 0; i < times; i++) faults.push(fault);
    },
    respondWith(value) {
      responses.push(value);
    },
    reset() {
      faults.length = 0;
      responses.length = 0;
      calls.length = 0;
    },

    async generateObject<T>(req: ObjectRequest<T>, call: ResolvedCall): Promise<ObjectResult<T>> {
      calls.push({
        kind: 'object',
        task: req.task,
        modelId: call.modelId,
        tier: call.tier,
        messageCount: req.messages.length,
        fixture: req.fixture,
      });
      await applyFault(call.signal);
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      const raw = lookupFixture(req);
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) throw new AiProviderError('invalid_output', 'mock: schema');
      return { value: parsed.data, meta: meta(call.modelId, latencyMs) };
    },

    async *generateStream(req: StreamRequest, call: ResolvedCall): AsyncIterable<StreamChunk> {
      calls.push({
        kind: 'stream',
        task: req.task,
        modelId: call.modelId,
        tier: call.tier,
        messageCount: req.messages.length,
        fixture: req.fixture,
      });
      try {
        await applyFault(call.signal);
      } catch (err) {
        // A stream that produces unparseable text is the streaming face of `invalid_json`.
        if (isProviderError(err) && err.errorClass === 'invalid_output') {
          yield { type: 'text', text: 'Here is the reading: {"synthesis": ' };
          yield { type: 'text', text: 'this is not valid JSON' };
          yield { type: 'done', meta: meta(call.modelId, latencyMs) };
          return;
        }
        throw err;
      }
      let raw: unknown;
      try {
        raw = lookupFixture(req);
      } catch {
        raw = 'mock stream';
      }
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      for (const piece of pieces(text)) {
        if (call.signal.aborted) throw new AiProviderError('timeout');
        if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
        yield { type: 'text', text: piece };
      }
      yield { type: 'done', meta: meta(call.modelId, latencyMs) };
    },

    async embed(req: EmbedRequest): Promise<EmbedResult> {
      calls.push({ kind: 'embed', task: req.task });
      const vectors = req.texts.map(mockEmbedding);
      return {
        vectors,
        meta: { modelId: 'mock-embed', modelVersion: '1', tokensIn: 10, costMicros: 0 },
      };
    },
  };
  return provider;
}
