import 'server-only';
/**
 * Server-side entry point for AI calls. Wires env → routing → provider → runner. The provider
 * is chosen by `AI_PROVIDER`; nothing outside src/ai/ knows which one is live. Embeddings have
 * their own adapter (OpenAI) behind the same runner-free `embed()` shape.
 */
import { serverEnv } from '@/config/env.server';
import { AiProviderError } from './provider';
import { createAnthropicProvider } from './providers/anthropic';
import { createMockProvider, type MockProvider } from './providers/mock';
import { createOpenAiEmbeddings, type Embedder } from './providers/openai-embeddings';
import { routingFromEnv, validateRouting } from './registry';
import { createAiRunner, type AiRunner } from './run';
import * as classifySafety from './tasks/classify_safety';
import { mockSafety } from './tasks/classify_safety/mock';
import * as interpretReading from './tasks/interpret_reading';
import { mockInterpretation } from './tasks/interpret_reading/mock';
import { DbTelemetry, MemoryTelemetry, MultiTelemetry } from './telemetry';
import type { EmbedRequest, EmbedResult } from './types';

let runner: AiRunner | undefined;
let mock: MockProvider | undefined;
let embedder: Embedder | undefined;

const VERSIONS: Record<string, { promptVersion: string; schemaVersion: string }> = {
  interpret_reading: {
    promptVersion: interpretReading.PROMPT_VERSION,
    schemaVersion: interpretReading.SCHEMA_VERSION,
  },
  classify_safety: {
    promptVersion: classifySafety.PROMPT_VERSION,
    schemaVersion: classifySafety.SCHEMA_VERSION,
  },
};

export function taskVersions(task: string): { promptVersion: string; schemaVersion: string } {
  return VERSIONS[task] ?? { promptVersion: '', schemaVersion: '' };
}

/** The mock provider's canned behaviour, shared by dev, e2e and the eval runner's dry mode. */
export function mockFixtures() {
  return {
    interpret_reading: { default: mockInterpretation },
    classify_safety: { default: mockSafety },
  };
}

export function getAiRunner(): AiRunner {
  if (runner) return runner;
  const env = serverEnv();
  const routing = routingFromEnv(env);
  validateRouting(routing);
  const telemetry = new MultiTelemetry([new MemoryTelemetry(), new DbTelemetry()]);
  if (env.AI_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    const provider = createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      versions: taskVersions,
    });
    runner = createAiRunner({ provider, routing, telemetry });
    return runner;
  }
  mock = createMockProvider({
    fixtures: mockFixtures(),
    latencyMs: env.NODE_ENV === 'test' ? 0 : 12,
  });
  runner = createAiRunner({ provider: mock, routing, telemetry });
  return runner;
}

/** Test-only handle on the mock provider (fault injection from e2e fixtures is not exposed). */
export function getMockProvider(): MockProvider | undefined {
  return mock;
}

/**
 * Question embeddings (Phase 04: repeat detection only). With the mock provider the mock's
 * deterministic vectors are used; with the real provider OpenAI is required.
 */
export function getEmbedder(): Embedder {
  if (embedder) return embedder;
  const env = serverEnv();
  if (env.AI_PROVIDER === 'anthropic') {
    if (!env.OPENAI_API_KEY) {
      embedder = {
        id: 'none',
        embed: async () => {
          throw new AiProviderError('unsupported', 'OPENAI_API_KEY not set');
        },
      };
      return embedder;
    }
    embedder = createOpenAiEmbeddings({
      apiKey: env.OPENAI_API_KEY,
      model: env.AI_EMBEDDING_MODEL,
    });
    return embedder;
  }
  getAiRunner();
  embedder = {
    id: 'mock',
    embed: (req: EmbedRequest): Promise<EmbedResult> => mock!.embed(req),
  };
  return embedder;
}

/** Health probe: is the configured provider usable? Makes no call. */
export function describeProviderConfig(): {
  provider: string;
  configured: boolean;
  routing: boolean;
  embeddings: boolean;
} {
  const env = serverEnv();
  let routing = true;
  try {
    validateRouting(routingFromEnv(env));
  } catch {
    routing = false;
  }
  const configured = env.AI_PROVIDER === 'mock' || Boolean(env.ANTHROPIC_API_KEY);
  const embeddings = env.AI_PROVIDER === 'mock' || Boolean(env.OPENAI_API_KEY);
  return { provider: env.AI_PROVIDER, configured, routing, embeddings };
}

/** Test-only: forget the singletons so a test can rebuild with a stubbed env. */
export function resetAiForTests(): void {
  runner = undefined;
  mock = undefined;
  embedder = undefined;
}
