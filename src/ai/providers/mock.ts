/**
 * Deterministic mock provider. Canned responses keyed by task + fixture name, plus fault
 * injection so every branch of run.ts is testable without a network.
 */
import { AiProviderError, type AiProvider } from '../provider';
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

export type FixtureTable = Partial<Record<TaskId, Record<string, unknown>>>;

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

function meta(modelId: string, latencyMs: number, repaired = false): ResultMeta {
  return {
    modelId,
    promptVersion: 'mock-1',
    schemaVersion: 'mock-1',
    tokensIn: 100,
    tokensOut: 50,
    costMicros: 0,
    latencyMs,
    repaired,
  };
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

  function lookupFixture(task: TaskId, fixture: string | undefined): unknown {
    if (responses.length > 0) return responses.shift();
    const table = fixtures[task];
    const name = fixture ?? 'default';
    if (table && name in table) return table[name];
    throw new AiProviderError('invalid_output', `mock: no fixture ${task}/${name}`);
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
      const raw = lookupFixture(req.task, req.fixture);
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
      await applyFault(call.signal);
      const table = fixtures[req.task];
      const name = req.fixture ?? 'default';
      const text =
        table && typeof table[name] === 'string' ? (table[name] as string) : 'mock stream';
      for (const word of text.split(' ')) {
        if (call.signal.aborted) throw new AiProviderError('timeout');
        yield { type: 'text', text: `${word} ` };
      }
      yield { type: 'done', meta: meta(call.modelId, latencyMs) };
    },

    async embed(req: EmbedRequest): Promise<EmbedResult> {
      calls.push({ kind: 'embed', task: req.task });
      // Deterministic pseudo-vectors so retrieval tests are reproducible.
      const vectors = req.texts.map((t) => {
        const v = new Array<number>(8).fill(0);
        for (let i = 0; i < t.length; i++) {
          const idx = i % 8;
          v[idx] = (v[idx] ?? 0) + t.charCodeAt(i) / 1000;
        }
        return v;
      });
      return {
        vectors,
        meta: { modelId: 'mock-embed', modelVersion: '1', tokensIn: 10, costMicros: 0 },
      };
    },
  };
  return provider;
}
