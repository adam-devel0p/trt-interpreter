import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as extractTask from '@/ai/tasks/extract_event_metadata';
import { platformDb } from '@/db/admin';
import { extractions, lifeEvents, profiles } from '@/db/schema';
import { sourceHash } from '@/domain/extraction/hash';
import { flagForUser } from '@/flags/server';
import { currentExtraction, materializeEvent, type MaterializeResult } from '@/memory/materialize';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * The event extraction run (spec §6.4, §7.2) — the reading run's sibling, same contract:
 *
 *   1. the event exists and is not deleted — it is already usable, before, during and after;
 *   2. gates: `profiles.ai_consent_at` and the `ai_extraction` flag — no consent, no call;
 *   3. freshness: a current extraction for the same schema, `metadata_version` and text hash
 *      means nothing to do (unless forced);
 *   4. a `pending` row is written **before** the model is called;
 *   5. `extract_event_metadata` runs through the runner (validated by the versioned schema);
 *   6. complete → the row carries the payload and supersedes the previous current one (never
 *      deleted); failed → the row carries the class. Then the tables are materialised.
 *
 * Reads the user's words; never writes them (invariant 4). Logs ids and classes only.
 */

export type EventExtractionOutcome =
  | { status: 'skipped'; reason: 'missing' | 'deleted' | 'consent' | 'flag' | 'fresh' }
  | {
      status: 'complete';
      extractionId: string;
      supersededId: string | null;
      materialized: MaterializeResult;
    }
  | { status: 'failed'; extractionId: string; errorClass: string; retryable: boolean };

export interface RunEventExtractionOptions {
  force?: boolean;
  runner?: AiRunner;
  timeoutMs?: number;
}

const RETRYABLE = new Set(['timeout', 'provider_error']);

export async function runEventExtraction(
  eventId: string,
  opts: RunEventExtractionOptions = {},
): Promise<EventExtractionOutcome> {
  const db = platformDb();
  const [event] = await db
    .select({
      id: lifeEvents.id,
      userId: lifeEvents.userId,
      description: lifeEvents.description,
      note: lifeEvents.note,
      occurredOn: lifeEvents.occurredOn,
      metadataVersion: lifeEvents.metadataVersion,
      deletedAt: lifeEvents.deletedAt,
    })
    .from(lifeEvents)
    .where(eq(lifeEvents.id, eventId))
    .limit(1);
  if (!event) return { status: 'skipped', reason: 'missing' };
  if (event.deletedAt) return { status: 'skipped', reason: 'deleted' };

  const [profile] = await db
    .select({ aiConsentAt: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, event.userId))
    .limit(1);
  if (!profile?.aiConsentAt) return { status: 'skipped', reason: 'consent' };
  if (!(await flagForUser('ai_extraction', event.userId)))
    return { status: 'skipped', reason: 'flag' };

  const versions = {
    promptVersion: extractTask.PROMPT_VERSION,
    schemaVersion: extractTask.SCHEMA_VERSION,
  };
  const hash = sourceHash(event.description, event.note);
  const current = await currentExtraction('life_event', eventId);
  if (
    !opts.force &&
    current &&
    current.schemaVersion === versions.schemaVersion &&
    current.metadataVersion === event.metadataVersion &&
    current.sourceHash === hash
  ) {
    return { status: 'skipped', reason: 'fresh' };
  }

  const [pending] = await db
    .insert(extractions)
    .values({
      userId: event.userId,
      objectType: 'life_event',
      objectId: eventId,
      status: 'pending',
      schemaVersion: versions.schemaVersion,
      promptVersion: versions.promptVersion,
      metadataVersion: event.metadataVersion,
      sourceHash: hash,
    })
    .returning({ id: extractions.id });
  const extractionId = pending!.id;
  logger.info('memory.extraction.started', {
    userId: event.userId,
    objectType: 'life_event',
    objectId: eventId,
  });

  const runner = opts.runner ?? getAiRunner();
  const req = {
    ...extractTask.buildExtractEventRequest(
      { description: event.description, note: event.note, occurred_on: event.occurredOn },
      { userId: event.userId, eventId },
    ),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  const res = await runner.runObject(req);

  if (!res.ok) {
    await db
      .update(extractions)
      .set({ status: 'failed', errorClass: res.errorClass, completedAt: new Date() })
      .where(eq(extractions.id, extractionId));
    logger.info('memory.extraction.failed', {
      userId: event.userId,
      objectType: 'life_event',
      objectId: eventId,
      errorClass: res.errorClass,
      status: res.status,
    });
    return {
      status: 'failed',
      extractionId,
      errorClass: res.errorClass,
      retryable: RETRYABLE.has(res.status),
    };
  }

  let materialized: MaterializeResult;
  try {
    await db
      .update(extractions)
      .set({ payload: res.value })
      .where(eq(extractions.id, extractionId));
    materialized = await materializeEvent(eventId, {
      extraction: { id: extractionId, payload: res.value },
    });
  } catch (err) {
    await db
      .update(extractions)
      .set({ status: 'failed', errorClass: 'materialize_error', completedAt: new Date() })
      .where(eq(extractions.id, extractionId));
    logger.warn('memory.extraction.materialize_failed', {
      userId: event.userId,
      objectType: 'life_event',
      objectId: eventId,
      errorClass: errorClassOf(err),
    });
    return { status: 'failed', extractionId, errorClass: 'materialize_error', retryable: true };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(extractions)
      .set({ supersededBy: extractionId })
      .where(
        and(
          eq(extractions.objectType, 'life_event'),
          eq(extractions.objectId, eventId),
          eq(extractions.status, 'complete'),
          isNull(extractions.supersededBy),
          ne(extractions.id, extractionId),
        ),
      );
    await tx
      .update(extractions)
      .set({
        status: 'complete',
        modelId: res.meta.modelId,
        tokensIn: res.meta.tokensIn,
        tokensOut: res.meta.tokensOut,
        costMicros: res.meta.costMicros,
        latencyMs: res.meta.latencyMs,
        completedAt: new Date(),
      })
      .where(eq(extractions.id, extractionId));
  });
  logger.info('memory.extraction.completed', {
    userId: event.userId,
    objectType: 'life_event',
    objectId: eventId,
    count: materialized.mentions,
  });
  return { status: 'complete', extractionId, supersededId: current?.id ?? null, materialized };
}
