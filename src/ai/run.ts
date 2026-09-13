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
import { AiProviderError, isProviderError, type AiProvider } from './provider';
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

/** A streamed structured call: text deltas while the model writes, then the validated object. */
export interface StreamObjectRequest<T> extends StreamRequest {
  schema: z.ZodType<T>;
  /**
   * Extra validation after the schema (deck purity, register). Returns content-free issue
   * labels; a non-empty list counts as invalid output and triggers the one repair turn.
   */
  validate?: (value: T) => string[];
  /** Text prepended to the repair turn when `validate` fails (may name the offending terms). */
  repairHint?: (issues: string[]) => string;
}

export type StreamObjectEvent<T> =
  | { type: 'text'; text: string }
  | { type: 'reset'; reason: 'repair' | 'retry' }
  | { type: 'done'; value: T; meta: ResultMeta; attempts: number }
  | {
      type: 'failed';
      status: Exclude<RunStatus, 'ok'>;
      errorClass: ProviderErrorClass;
      attempts: number;
      /** For invalid output: the validator's content-free issue labels from the last attempt. */
      issues?: string[];
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
  /** Streaming with the same policy as `runObject` (repair, timeout/downgrade, backoff, breaker). */
  runStreamObject<T>(req: StreamObjectRequest<T>): AsyncIterable<StreamObjectEvent<T>>;
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

  /**
   * Streamed structured output. Each attempt streams text deltas; at `done` the accumulated text
   * is parsed, schema-checked and `validate`d. A failure there is treated exactly like invalid
   * output from `runObject` (one repair turn), and every provider failure follows the same
   * timeout / downgrade / backoff / breaker policy. A `reset` event tells the consumer to
   * discard the partial text of the attempt that just failed.
   */
  async function* runStreamObject<T>(
    req: StreamObjectRequest<T>,
  ): AsyncIterable<StreamObjectEvent<T>> {
    const started = now();
    let tier: ModelTier = req.modelHint ?? tierForTask(req.task);
    let attempts = 0;
    let timeouts = 0;
    let rateFailures = 0;
    let repaired = false;
    let messages: Message[] = req.messages;

    const record = async (
      result:
        | { ok: true; meta: ResultMeta }
        | { ok: false; status: RunStatus; errorClass: ProviderErrorClass },
      modelId: string,
    ) => {
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
    };

    const fail = async (
      status: Exclude<RunStatus, 'ok'>,
      errorClass: ProviderErrorClass,
      modelId: string,
      issues?: string[],
    ): Promise<StreamObjectEvent<T>> => {
      await record({ ok: false, status, errorClass }, modelId);
      return issues?.length
        ? { type: 'failed', status, errorClass, attempts, issues }
        : { type: 'failed', status, errorClass, attempts };
    };

    if (breaker.isOpen()) {
      yield await fail('provider_error', 'circuit_open', modelForTier(deps.routing, tier));
      return;
    }
    const verdict = await budget.check(req.userId, req.task);
    if (!verdict.allowed) {
      yield await fail('budget_denied', 'budget_denied', modelForTier(deps.routing, tier));
      return;
    }

    for (;;) {
      const modelId = modelForTier(deps.routing, tier);
      const timeoutMs = req.timeoutMs ?? TIER_TIMEOUT_MS[tier];
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let text = '';
      let finalMeta: ResultMeta | undefined;
      let emitted = false;
      let err: unknown;
      try {
        for await (const chunk of provider.generateStream(
          { ...req, messages },
          { modelId, tier, signal: controller.signal },
        )) {
          if (chunk.type === 'text') {
            text += chunk.text;
            emitted = true;
            yield chunk;
          } else if (chunk.type === 'done') {
            finalMeta = chunk.meta;
          } else if (chunk.type === 'error') {
            throw new AiProviderError(chunk.errorClass);
          }
        }
        if (!finalMeta) throw new AiProviderError('unknown', 'stream ended without done');
        let parsed: unknown;
        try {
          parsed = parseJsonDocument(text);
        } catch {
          throw new InvalidOutputSignal(1, ['not_json']);
        }
        const checked = req.schema.safeParse(parsed);
        if (!checked.success)
          throw new InvalidOutputSignal(checked.error.issues.length, ['schema']);
        const issues = req.validate?.(checked.data) ?? [];
        if (issues.length > 0) throw new InvalidOutputSignal(issues.length, issues);
        breaker.recordSuccess();
        clearTimeout(timer);
        const meta = { ...finalMeta, repaired };
        await record({ ok: true, meta }, modelId);
        yield { type: 'done', value: checked.data, meta, attempts };
        return;
      } catch (e) {
        err = e;
      } finally {
        clearTimeout(timer);
      }

      const cls = controller.signal.aborted ? 'timeout' : classify(err);

      if (cls === 'invalid_output') {
        const issues = err instanceof InvalidOutputSignal ? err.issues : [];
        if (repaired) {
          yield await fail('invalid_output', cls, modelId, issues);
          return;
        }
        repaired = true;
        const hint = req.repairHint && issues.length ? req.repairHint(issues) : '';
        messages = [
          ...messages,
          ...(text ? [{ role: 'assistant' as const, content: text }] : []),
          repairMessage(req.schema, hint),
        ];
        if (emitted) yield { type: 'reset', reason: 'repair' };
        continue;
      }

      if (cls === 'timeout') {
        timeouts += 1;
        if (timeouts === 1) {
          if (emitted) yield { type: 'reset', reason: 'retry' };
          continue;
        }
        const lower = downgradeTier(tier);
        if (timeouts === 2 && lower) {
          tier = lower;
          if (emitted) yield { type: 'reset', reason: 'retry' };
          continue;
        }
        yield await fail('timeout', cls, modelId);
        return;
      }

      if (cls === 'rate_limited' || cls === 'server_error') {
        breaker.recordFailure();
        rateFailures += 1;
        if (rateFailures < RETRY_POLICY.maxRateLimitAttempts && !breaker.isOpen()) {
          await sleep(backoffMs(rateFailures));
          if (emitted) yield { type: 'reset', reason: 'retry' };
          continue;
        }
        yield await fail('provider_error', breaker.isOpen() ? 'circuit_open' : cls, modelId);
        return;
      }

      if (cls === 'refusal') {
        yield await fail('refusal', cls, modelId);
        return;
      }

      breaker.recordFailure();
      yield await fail('provider_error', cls, modelId);
      return;
    }
  }

  return { runObject, runStream, runStreamObject, breaker };
}

class TimeoutSignal extends Error {
  override readonly name = 'TimeoutSignal';
}
class InvalidOutputSignal extends Error {
  override readonly name = 'InvalidOutputSignal';
  constructor(
    public readonly issueCount: number,
    /** Content-free issue labels (validator names, offending deck terms). */
    public readonly issues: string[] = [],
  ) {
    super('schema validation failed');
  }
}

/** Fence-tolerant parse of a complete JSON object; throws when it is not one. */
export function parseJsonDocument(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new SyntaxError('no JSON object');
  return JSON.parse(text.slice(start, end + 1));
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
function repairMessage(schema: z.ZodType, hint = ''): Message {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return {
    role: 'user',
    content:
      'Your previous response did not match the required schema. ' +
      (hint ? `${hint} ` : '') +
      `Respond again with only a JSON object matching this schema: ${jsonSchema}`,
  };
}

export { routingFromEnv };
