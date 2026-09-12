/**
 * The single call wrapper every AI task goes through (docs/AI_LAYER.md#failure-handling).
 *
 * Policy, in order, per call:
 *   1. Circuit breaker open            → soft fail `provider_error` / `circuit_open`, no call.
 *   2. Budget check                    → soft fail `budget_denied`, no call.
 *   3. Provider attempt (with timeout)
 *      - invalid output                → ONE repair attempt (error + schema echoed), then soft fail.
 *      - timeout                       → retry once at the same tier → downgrade one tier → soft fail.
 *      - 429 / 5xx                     → exponential backoff + jitter, max 3 attempts, then soft fail.
 *                                        Each counts toward the breaker (opens after 5 consecutive).
 *      - refusal                       → terminal, surfaced honestly.
 *   4. Telemetry record (content-free) on every terminal outcome.
 *
 * Nothing here throws for a model problem: callers always get a `RunResult` and the user's
 * content is already persisted before any of this runs.
 */
import { z } from 'zod';
import { CircuitBreaker } from './circuitBreaker';
import { isProviderError, type AiProvider } from './provider';
import {
  downgradeTier,
  modelForTier,
  routingFromEnv,
  tierForTask,
  TIER_TIMEOUT_MS,
  type ModelRouting,
} from './registry';
import {
  noopTelemetry,
  unlimitedBudget,
  type AiTelemetrySink,
  type BudgetPolicy,
} from './telemetry';
import type {
  Message,
  ModelTier,
  ObjectRequest,
  ObjectResult,
  ProviderErrorClass,
  ResultMeta,
  RunStatus,
  StreamChunk,
  StreamRequest,
} from './types';

export type RunResult<T> =
  | { ok: true; value: T; meta: ResultMeta; attempts: number }
  | {
      ok: false;
      status: Exclude<RunStatus, 'ok'>;
      errorClass: ProviderErrorClass;
      attempts: number;
    };

export interface RunnerDeps {
  provider: AiProvider;
  routing: ModelRouting;
  telemetry?: AiTelemetrySink;
  budget?: BudgetPolicy;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export const RETRY_POLICY = {
  maxRateLimitAttempts: 3,
  backoffBaseMs: 500,
  backoffMaxMs: 8_000,
  breakerThreshold: 5,
  breakerCooldownMs: 60_000,
} as const;

export interface AiRunner {
  runObject<T>(req: ObjectRequest<T>): Promise<RunResult<T>>;
  runStream(req: StreamRequest): AsyncIterable<StreamChunk>;
  readonly breaker: CircuitBreaker;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createAiRunner(deps: RunnerDeps): AiRunner {
  const provider = deps.provider;
  const telemetry = deps.telemetry ?? noopTelemetry;
  const budget = deps.budget ?? unlimitedBudget;
  const breaker =
    deps.breaker ??
    new CircuitBreaker({
      threshold: RETRY_POLICY.breakerThreshold,
      cooldownMs: RETRY_POLICY.breakerCooldownMs,
      now: deps.now,
    });
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;

  function backoffMs(attempt: number): number {
    const base = Math.min(RETRY_POLICY.backoffBaseMs * 2 ** attempt, RETRY_POLICY.backoffMaxMs);
    return Math.round(base * (0.5 + random() * 0.5));
  }

  async function attemptWithTimeout<R>(
    timeoutMs: number,
    fn: (signal: AbortSignal) => Promise<R>,
  ): Promise<R> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutSignal());
      }, timeoutMs);
    });
    try {
      return await Promise.race([fn(controller.signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function runObject<T>(req: ObjectRequest<T>): Promise<RunResult<T>> {
    const started = now();
    let tier: ModelTier = req.modelHint ?? tierForTask(req.task);
    let attempts = 0;
    let timeouts = 0;
    let rateFailures = 0;
    let repaired = false;
    let messages: Message[] = req.messages;

    const finish = async (result: RunResult<T>, modelId: string): Promise<RunResult<T>> => {
      await telemetry.record({
        userId: req.userId ?? null,
        task: req.task,
        modelId,
        promptVersion: result.ok ? result.meta.promptVersion : '',
        schemaVersion: result.ok ? result.meta.schemaVersion : '',
        tokensIn: result.ok ? result.meta.tokensIn : 0,
        tokensOut: result.ok ? result.meta.tokensOut : 0,
        costMicros: result.ok ? result.meta.costMicros : 0,
        latencyMs: now() - started,
        status: result.ok ? 'ok' : result.status,
        errorClass: result.ok ? null : result.errorClass,
        attempts,
        objectRefs: req.objectRefs ?? [],
      });
      return result;
    };

    if (breaker.isOpen()) {
      return finish(
        { ok: false, status: 'provider_error', errorClass: 'circuit_open', attempts },
        modelForTier(deps.routing, tier),
      );
    }
    const verdict = await budget.check(req.userId, req.task);
    if (!verdict.allowed) {
      return finish(
        { ok: false, status: 'budget_denied', errorClass: 'budget_denied', attempts },
        modelForTier(deps.routing, tier),
      );
    }

    // Bounded by construction: at most 1 repair + 2 timeouts + 1 downgrade + 3 rate-limit tries.
    for (;;) {
      const modelId = modelForTier(deps.routing, tier);
      const timeoutMs = req.timeoutMs ?? TIER_TIMEOUT_MS[tier];
      attempts += 1;
      try {
        const result: ObjectResult<T> = await attemptWithTimeout(timeoutMs, (signal) =>
          provider.generateObject({ ...req, messages }, { modelId, tier, signal }),
        );
        const parsed = req.schema.safeParse(result.value);
        if (!parsed.success) throw new InvalidOutputSignal(parsed.error.issues.length);
        breaker.recordSuccess();
        return finish(
          { ok: true, value: parsed.data, meta: { ...result.meta, repaired }, attempts },
          modelId,
        );
      } catch (err) {
        const cls = classify(err);

        if (cls === 'invalid_output') {
          if (repaired) {
            return finish(
              { ok: false, status: 'invalid_output', errorClass: cls, attempts },
              modelId,
            );
          }
          repaired = true;
          messages = [...messages, repairMessage(req.schema)];
          continue;
        }

        if (cls === 'timeout') {
          timeouts += 1;
          if (timeouts === 1) continue; // retry once at the same tier
          const lower = downgradeTier(tier);
          if (timeouts === 2 && lower) {
            tier = lower;
            continue;
          }
          return finish({ ok: false, status: 'timeout', errorClass: cls, attempts }, modelId);
        }

        if (cls === 'rate_limited' || cls === 'server_error') {
          breaker.recordFailure();
          rateFailures += 1;
          if (rateFailures < RETRY_POLICY.maxRateLimitAttempts && !breaker.isOpen()) {
            await sleep(backoffMs(rateFailures));
            continue;
          }
          return finish(
            {
              ok: false,
              status: 'provider_error',
              errorClass: breaker.isOpen() ? 'circuit_open' : cls,
              attempts,
            },
            modelId,
          );
        }

        if (cls === 'refusal') {
          return finish({ ok: false, status: 'refusal', errorClass: cls, attempts }, modelId);
        }

        // unsupported / unknown: not retryable.
        breaker.recordFailure();
        return finish({ ok: false, status: 'provider_error', errorClass: cls, attempts }, modelId);
      }
    }
  }

  async function* runStream(req: StreamRequest): AsyncIterable<StreamChunk> {
    const tier: ModelTier = req.modelHint ?? tierForTask(req.task);
    const modelId = modelForTier(deps.routing, tier);
    if (breaker.isOpen()) {
      yield { type: 'error', errorClass: 'circuit_open' };
      return;
    }
    const verdict = await budget.check(req.userId, req.task);
    if (!verdict.allowed) {
      yield { type: 'error', errorClass: 'budget_denied' };
      return;
    }
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? TIER_TIMEOUT_MS[tier];
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    let status: RunStatus = 'ok';
    let errorClass: ProviderErrorClass | null = null;
    let finalMeta: ResultMeta | undefined;
    try {
      for await (const chunk of provider.generateStream(req, {
        modelId,
        tier,
        signal: controller.signal,
      })) {
        if (chunk.type === 'done') finalMeta = chunk.meta;
        yield chunk;
      }
      breaker.recordSuccess();
    } catch (err) {
      errorClass = controller.signal.aborted ? 'timeout' : classify(err);
      status = statusForClass(errorClass);
      if (errorClass === 'rate_limited' || errorClass === 'server_error') breaker.recordFailure();
      yield { type: 'error', errorClass };
    } finally {
      clearTimeout(timer);
      await telemetry.record({
        userId: req.userId ?? null,
        task: req.task,
        modelId,
        promptVersion: finalMeta?.promptVersion ?? '',
        schemaVersion: finalMeta?.schemaVersion ?? '',
        tokensIn: finalMeta?.tokensIn ?? 0,
        tokensOut: finalMeta?.tokensOut ?? 0,
        costMicros: finalMeta?.costMicros ?? 0,
        latencyMs: now() - started,
        status,
        errorClass,
        attempts: 1,
        objectRefs: req.objectRefs ?? [],
      });
    }
  }

  return { runObject, runStream, breaker };
}

class TimeoutSignal extends Error {
  override readonly name = 'TimeoutSignal';
}
class InvalidOutputSignal extends Error {
  override readonly name = 'InvalidOutputSignal';
  constructor(public readonly issueCount: number) {
    super('schema validation failed');
  }
}

function classify(err: unknown): ProviderErrorClass {
  if (err instanceof TimeoutSignal) return 'timeout';
  if (err instanceof InvalidOutputSignal) return 'invalid_output';
  if (isProviderError(err)) return err.errorClass;
  return 'unknown';
}

function statusForClass(cls: ProviderErrorClass): RunStatus {
  switch (cls) {
    case 'invalid_output':
      return 'invalid_output';
    case 'timeout':
      return 'timeout';
    case 'refusal':
      return 'refusal';
    case 'budget_denied':
      return 'budget_denied';
    default:
      return 'provider_error';
  }
}

/** Repair turn: the error and the schema echoed back, no model text quoted. */
function repairMessage(schema: z.ZodType): Message {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return {
    role: 'user',
    content:
      'Your previous response did not match the required schema. ' +
      `Respond again with only a JSON object matching this schema: ${jsonSchema}`,
  };
}

export { routingFromEnv };
