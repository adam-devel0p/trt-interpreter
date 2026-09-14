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
import * as answerFromEvidence from './tasks/answer_from_evidence';
import { mockHistoryAnswer } from './tasks/answer_from_evidence/mock';
import * as classifySafety from './tasks/classify_safety';
import { mockSafety } from './tasks/classify_safety/mock';
import * as explainCorrelation from './tasks/explain_correlation';
import { mockExplanation } from './tasks/explain_correlation/mock';
import * as extractEvent from './tasks/extract_event_metadata';
import { mockEventExtraction } from './tasks/extract_event_metadata/mock';
import * as extractReading from './tasks/extract_reading_metadata';
import { mockExtraction } from './tasks/extract_reading_metadata/mock';
import * as interpretReading from './tasks/interpret_reading';
import * as journeyNarrative from './tasks/journey_narrative';
import { mockJourneyNarrative } from './tasks/journey_narrative/mock';
import { mockInterpretation } from './tasks/interpret_reading/mock';
import * as parseHistoryQuery from './tasks/parse_history_query';
import { mockHistoryQuery } from './tasks/parse_history_query/mock';
import * as proposeJourney from './tasks/propose_journey';
import { mockJourneyProposal } from './tasks/propose_journey/mock';
import * as summarizePeriod from './tasks/summarize_period';
import { mockPeriodSummary } from './tasks/summarize_period/mock';
import { DbBudgetPolicy, DbTelemetry, MemoryTelemetry, MultiTelemetry } from './telemetry';
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
  extract_reading_metadata: {
    promptVersion: extractReading.PROMPT_VERSION,
    schemaVersion: extractReading.SCHEMA_VERSION,
  },
  propose_journey: {
    promptVersion: proposeJourney.PROMPT_VERSION,
    schemaVersion: proposeJourney.SCHEMA_VERSION,
  },
  extract_event_metadata: {
    promptVersion: extractEvent.PROMPT_VERSION,
    schemaVersion: extractEvent.SCHEMA_VERSION,
  },
  explain_correlation: {
    promptVersion: explainCorrelation.PROMPT_VERSION,
    schemaVersion: explainCorrelation.SCHEMA_VERSION,
  },
  parse_history_query: {
    promptVersion: parseHistoryQuery.PROMPT_VERSION,
    schemaVersion: parseHistoryQuery.SCHEMA_VERSION,
  },
  answer_from_evidence: {
    promptVersion: answerFromEvidence.PROMPT_VERSION,
    schemaVersion: answerFromEvidence.SCHEMA_VERSION,
  },
  summarize_period: {
    promptVersion: summarizePeriod.PROMPT_VERSION,
    schemaVersion: summarizePeriod.SCHEMA_VERSION,
  },
  journey_narrative: {
    promptVersion: journeyNarrative.PROMPT_VERSION,
    schemaVersion: journeyNarrative.SCHEMA_VERSION,
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
    extract_reading_metadata: { default: mockExtraction },
    propose_journey: { default: mockJourneyProposal },
    extract_event_metadata: { default: mockEventExtraction },
    explain_correlation: { default: mockExplanation },
    parse_history_query: { default: mockHistoryQuery },
    answer_from_evidence: { default: mockHistoryAnswer },
    summarize_period: { default: mockPeriodSummary },
    journey_narrative: { default: mockJourneyNarrative },
  };
}

export function getAiRunner(): AiRunner {
  if (runner) return runner;
  const env = serverEnv();
  const routing = routingFromEnv(env);
  validateRouting(routing);
  const telemetry = new MultiTelemetry([new MemoryTelemetry(), new DbTelemetry()]);
  const budget = new DbBudgetPolicy();
  if (env.AI_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    const provider = createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      versions: taskVersions,
    });
    runner = createAiRunner({ provider, routing, telemetry, budget });
    return runner;
  }
  mock = createMockProvider({
    fixtures: mockFixtures(),
    latencyMs: env.NODE_ENV === 'test' ? 0 : 12,
  });
  runner = createAiRunner({ provider: mock, routing, telemetry, budget });
  return runner;
}

/** Test-only handle on the mock provider (fault injection from e2e fixtures is not exposed). */
export function getMockProvider(): MockProvider | undefined {
  return mock;
}

/**
 * Embeddings (Phase 04: repeat detection; Phase 09: retrieval documents). With the mock
 * provider the mock's deterministic vectors are used; with the real provider OpenAI is required.
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

/**
 * The embedding model a fresh vector would be produced by — compared against
 * `embeddings.model` so a model change is a re-embedding job, not a rewrite (§8.3).
 */
export function embeddingModelId(): string {
  const env = serverEnv();
  return env.AI_PROVIDER === 'anthropic' ? env.AI_EMBEDDING_MODEL : 'mock-embed';
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
