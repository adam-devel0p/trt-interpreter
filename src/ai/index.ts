import 'server-only';
/**
 * Server-side entry point for AI calls. Wires env → routing → provider → runner. Phase 04 adds
 * the Anthropic provider behind this same factory; nothing outside src/ai/ changes.
 */
import { serverEnv } from '@/config/env.server';
import { createMockProvider, type MockProvider } from './providers/mock';
import { routingFromEnv, validateRouting } from './registry';
import { createAiRunner, type AiRunner } from './run';
import { MemoryTelemetry } from './telemetry';

let runner: AiRunner | undefined;
let mock: MockProvider | undefined;

export function getAiRunner(): AiRunner {
  if (runner) return runner;
  const env = serverEnv();
  const routing = routingFromEnv(env);
  validateRouting(routing);
  if (env.AI_PROVIDER !== 'mock') {
    throw new Error(`AI provider '${env.AI_PROVIDER}' is not available until Phase 04`);
  }
  mock = createMockProvider();
  runner = createAiRunner({ provider: mock, routing, telemetry: new MemoryTelemetry() });
  return runner;
}

/** Health probe: is the configured provider usable? Makes no call. */
export function describeProviderConfig(): {
  provider: string;
  configured: boolean;
  routing: boolean;
} {
  const env = serverEnv();
  let routing = true;
  try {
    validateRouting(routingFromEnv(env));
  } catch {
    routing = false;
  }
  const configured = env.AI_PROVIDER === 'mock' || Boolean(env.ANTHROPIC_API_KEY);
  return { provider: env.AI_PROVIDER, configured, routing };
}
