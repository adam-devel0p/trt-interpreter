/**
 * The interpretation run (spec §9.3, §10, §13). Order of operations is the contract:
 *
 *   1. the reading already exists (the caller loaded it through the query layer);
 *   2. consent gate — no consent, no call of any kind;
 *   3. a `pending` row is written *before* the model is called;
 *   4. classify_safety on the question (fail-soft to "none");
 *   5. interpret_reading streams; partial layers are persisted on a throttle;
 *   6. complete → the row is frozen; any failure → the row is `failed` with a class and
 *      whatever partial text arrived, and the reading is untouched throughout.
 *
 * The service never imports the readings query module's write functions: it has no path to
 * the user's text (invariant 4) and every event it emits is content the model produced or an
 * ID — the route hands them to the client, nothing goes to a log.
 */
import { buildSafetyRequest } from '@/ai/tasks/classify_safety';
import * as interpretReading from '@/ai/tasks/interpret_reading';
import { buildInterpretRequest, resolveCardIds } from '@/ai/tasks/interpret_reading';
import type { AiRunner } from '@/ai/run';
import type { ProfileRow } from '@/db/queries/profile';
import { hasAiConsent } from '@/db/queries/profile';
import type { ReadingView } from '@/db/queries/readings';
import { partialInterpretation } from '@/domain/interpretation/partialJson';
import { NO_FLAG, shouldSurface, type SafetyClassification } from '@/domain/safety/categories';
import { errorClassOf, logger } from '@/observability/logger';
import { failureMessage } from './copy';
import type { ServiceEvent } from './events';
import { depthFor, toInterpretInput } from './input';
import type { InterpretationStore } from './store';
import { bannedTermsFor } from './vocabulary';

export interface RunInterpretationArgs {
  reading: ReadingView;
  profile: Pick<ProfileRow, 'id' | 'ai_consent_at' | 'ai_explanation_depth' | 'experience_level'>;
  store: InterpretationStore;
  runner: AiRunner;
  /** Aborting marks the row `cancelled`; partial layers stay. */
  signal?: AbortSignal;
  /** How often partial layers are written while streaming. */
  partialFlushMs?: number;
  /** Per-attempt timeout override (tests); the tier default otherwise. */
  timeoutMs?: number;
  /** Phase 11: the plan's tier for interpretations (§14 "deeper model"); the task default otherwise. */
  modelTier?: 'standard' | 'deep';
  now?: () => number;
}

export const PARTIAL_FLUSH_MS = 1200;

export async function* runInterpretation(args: RunInterpretationArgs): AsyncIterable<ServiceEvent> {
  const { reading, profile, store, runner } = args;
  const now = args.now ?? Date.now;
  const userId = profile.id;

  if (!hasAiConsent(profile)) {
    yield {
      type: 'failed',
      interpretationId: '',
      errorClass: 'consent',
      message: failureMessage('consent'),
    };
    return;
  }

  const depth = depthFor(profile);
  const row = await store.createPending({
    readingId: reading.id,
    userId,
    metadataVersion: reading.metadata_version,
    depth: depth.depth,
    promptVersion: interpretReading.PROMPT_VERSION,
    schemaVersion: interpretReading.SCHEMA_VERSION,
  });
  yield { type: 'started', interpretationId: row.id, collapsedByDefault: depth.collapsedByDefault };
  logger.info('ai.interpretation.started', {
    userId,
    objectType: 'reading',
    objectId: reading.id,
    tier: depth.depth,
  });

  const finishFailed = async (
    errorClass: string,
    meta?: { modelId?: string; latencyMs?: number },
  ): Promise<ServiceEvent> => {
    try {
      await store.fail(row.id, errorClass, meta);
    } catch (err) {
      logger.warn('ai.interpretation.fail_write_failed', {
        objectId: row.id,
        errorClass: errorClassOf(err),
      });
    }
    logger.info('ai.interpretation.failed', { userId, objectId: row.id, errorClass });
    return {
      type: 'failed',
      interpretationId: row.id,
      errorClass,
      message: failureMessage(errorClass),
    };
  };

  // 4. Safety classification — on the question only; a classifier failure never blocks.
  let safety: SafetyClassification = NO_FLAG;
  if (!reading.is_open_reflection && reading.question) {
    const res = await runner.runObject(
      buildSafetyRequest(reading.question, { userId, readingId: reading.id }),
    );
    if (res.ok) safety = res.value;
    else logger.warn('ai.safety.unavailable', { objectId: reading.id, errorClass: res.errorClass });
  }
  if (safety.category !== 'none') {
    const surfaced = shouldSurface(safety);
    try {
      await store.recordSafetyFlag({
        userId,
        objectType: 'reading',
        objectId: reading.id,
        category: safety.category,
        severity: safety.severity,
        surfaced,
      });
    } catch (err) {
      logger.warn('ai.safety.record_failed', {
        objectId: reading.id,
        errorClass: errorClassOf(err),
      });
    }
    if (surfaced) yield { type: 'safety', category: safety.category, severity: safety.severity };
  }
  if (args.signal?.aborted) {
    yield await finishFailed('cancelled');
    return;
  }

  // 5. Interpretation, streamed.
  const input = toInterpretInput(reading, depth, safety);
  const req = {
    ...buildInterpretRequest(input, {
      userId,
      readingId: reading.id,
      bannedTerms: bannedTermsFor(reading.deck.system),
    }),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.modelTier ? { modelHint: args.modelTier } : {}),
  };
  const flushMs = args.partialFlushMs ?? PARTIAL_FLUSH_MS;
  let text = '';
  let lastFlush = 0;
  let flushing: Promise<void> | null = null;
  const flush = () => {
    if (flushing) return;
    lastFlush = now();
    flushing = store
      .updatePartial(row.id, partialInterpretation(text))
      .catch((err) =>
        logger.warn('ai.interpretation.partial_write_failed', {
          objectId: row.id,
          errorClass: errorClassOf(err),
        }),
      )
      .finally(() => {
        flushing = null;
      });
  };

  const started = now();
  const stream = runner.runStreamObject(req)[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (args.signal?.aborted) {
        await stream.return?.(undefined);
        if (flushing) await flushing;
        flush();
        if (flushing) await flushing;
        yield await finishFailed('cancelled', { latencyMs: now() - started });
        return;
      }
      const next = await stream.next();
      if (next.done) break;
      const ev = next.value;
      if (ev.type === 'text') {
        text += ev.text;
        yield { type: 'text', text: ev.text };
        if (now() - lastFlush >= flushMs) flush();
        continue;
      }
      if (ev.type === 'reset') {
        text = '';
        yield { type: 'reset' };
        continue;
      }
      if (ev.type === 'done') {
        if (flushing) await flushing;
        const output = resolveCardIds(ev.value, input);
        const meta = ev.meta;
        const completed = await store.complete(row.id, reading.id, {
          output,
          modelId: meta.modelId,
          promptVersion: interpretReading.PROMPT_VERSION,
          schemaVersion: interpretReading.SCHEMA_VERSION,
          tokensIn: meta.tokensIn,
          tokensOut: meta.tokensOut,
          costMicros: meta.costMicros,
          latencyMs: now() - started,
        });
        logger.info('ai.interpretation.completed', {
          userId,
          objectId: row.id,
          modelId: meta.modelId,
          promptVersion: interpretReading.PROMPT_VERSION,
          schemaVersion: interpretReading.SCHEMA_VERSION,
          tokensIn: meta.tokensIn,
          tokensOut: meta.tokensOut,
          costMicros: meta.costMicros,
          latencyMs: now() - started,
          attempts: ev.attempts,
        });
        yield { type: 'complete', interpretation: completed };
        return;
      }
      if (ev.type === 'failed') {
        if (flushing) await flushing;
        // Deck purity is an invalid-output class the user should hear about by name.
        const cls = ev.issues?.some((i) => i.startsWith('deck_purity:'))
          ? 'deck_purity'
          : ev.errorClass;
        yield await finishFailed(cls, { latencyMs: now() - started });
        return;
      }
    }
    yield await finishFailed('provider_error', { latencyMs: now() - started });
  } catch (err) {
    logger.error('ai.interpretation.crashed', { objectId: row.id, errorClass: errorClassOf(err) });
    yield await finishFailed('provider_error', { latencyMs: now() - started });
  }
}
