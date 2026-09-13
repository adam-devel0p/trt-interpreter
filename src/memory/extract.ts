import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as extractTask from '@/ai/tasks/extract_reading_metadata';
import { platformDb } from '@/db/admin';
import { cards, decks, extractions, profiles, readingCards, readings, spreads } from '@/db/schema';
import { sourceHash } from '@/domain/extraction/hash';
import { flagForUser } from '@/flags/server';
import { errorClassOf, logger } from '@/observability/logger';
import { currentExtraction, materializeReading, type MaterializeResult } from './materialize';

/**
 * The extraction run (spec §7.2, FR-08). Order of operations is the contract:
 *
 *   1. the reading exists and is not deleted — it is already usable, before, during and after;
 *   2. gates: `profiles.ai_consent_at` and the `ai_extraction` flag — no consent, no call;
 *   3. freshness: a current extraction for the same schema, `metadata_version` and text hash
 *      means nothing to do (unless forced);
 *   4. a `pending` row is written **before** the model is called;
 *   5. `extract_reading_metadata` runs through the runner (validated by the versioned schema);
 *   6. complete → the row carries the payload and supersedes the previous current one (never
 *      deleted); failed → the row carries the class. Then the tables are materialised.
 *
 * Reads the user's words; never writes `readings` (invariant 4). Logs ids and classes only.
 */

export type ExtractionOutcome =
  | { status: 'skipped'; reason: 'missing' | 'deleted' | 'consent' | 'flag' | 'fresh' }
  | {
      status: 'complete';
      extractionId: string;
      supersededId: string | null;
      materialized: MaterializeResult;
    }
  | { status: 'failed'; extractionId: string; errorClass: string; retryable: boolean };

export interface RunExtractionOptions {
  force?: boolean;
  runner?: AiRunner;
  /** Test hook: pretend to be a different prompt/schema version (reprocessing tests). */
  versions?: { promptVersion: string; schemaVersion: string };
  timeoutMs?: number;
}

const RETRYABLE = new Set(['timeout', 'provider_error']);

export async function runExtraction(
  readingId: string,
  opts: RunExtractionOptions = {},
): Promise<ExtractionOutcome> {
  const db = platformDb();
  const [reading] = await db
    .select({
      id: readings.id,
      userId: readings.userId,
      question: readings.question,
      isOpenReflection: readings.isOpenReflection,
      userNotes: readings.userNotes,
      lifeArea: readings.lifeArea,
      occurredAt: readings.occurredAt,
      metadataVersion: readings.metadataVersion,
      deletedAt: readings.deletedAt,
      deckName: decks.name,
      spreadName: spreads.name,
      positions: spreads.positions,
    })
    .from(readings)
    .innerJoin(decks, eq(decks.id, readings.deckId))
    .innerJoin(spreads, eq(spreads.id, readings.spreadId))
    .where(eq(readings.id, readingId))
    .limit(1);
  if (!reading) return { status: 'skipped', reason: 'missing' };
  if (reading.deletedAt) return { status: 'skipped', reason: 'deleted' };

  const [profile] = await db
    .select({ aiConsentAt: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, reading.userId))
    .limit(1);
  if (!profile?.aiConsentAt) return { status: 'skipped', reason: 'consent' };
  if (!(await flagForUser('ai_extraction', reading.userId)))
    return { status: 'skipped', reason: 'flag' };

  const versions = opts.versions ?? {
    promptVersion: extractTask.PROMPT_VERSION,
    schemaVersion: extractTask.SCHEMA_VERSION,
  };
  const hash = sourceHash(reading.question, reading.userNotes);
  const current = await currentExtraction('reading', readingId);
  if (
    !opts.force &&
    current &&
    current.schemaVersion === versions.schemaVersion &&
    current.metadataVersion === reading.metadataVersion &&
    current.sourceHash === hash
  ) {
    return { status: 'skipped', reason: 'fresh' };
  }

  const [pending] = await db
    .insert(extractions)
    .values({
      userId: reading.userId,
      objectType: 'reading',
      objectId: readingId,
      status: 'pending',
      schemaVersion: versions.schemaVersion,
      promptVersion: versions.promptVersion,
      metadataVersion: reading.metadataVersion,
      sourceHash: hash,
    })
    .returning({ id: extractions.id });
  const extractionId = pending!.id;
  logger.info('memory.extraction.started', {
    userId: reading.userId,
    objectType: 'reading',
    objectId: readingId,
  });

  const drawn = await db
    .select({
      positionIndex: readingCards.positionIndex,
      positionKey: readingCards.positionKey,
      orientation: readingCards.orientation,
      cardName: cards.name,
    })
    .from(readingCards)
    .innerJoin(cards, eq(cards.id, readingCards.cardId))
    .where(eq(readingCards.readingId, readingId))
    .orderBy(readingCards.positionIndex);
  const positions = (reading.positions ?? []) as { key: string; name: string }[];
  const input: extractTask.ExtractReadingInput = {
    question: reading.question,
    is_open_reflection: reading.isOpenReflection,
    user_notes: reading.userNotes,
    life_area: reading.lifeArea,
    occurred_on: reading.occurredAt.toISOString().slice(0, 10),
    deck_name: reading.deckName,
    spread_name: reading.spreadName,
    cards: drawn.map((c) => ({
      position_name: positions[c.positionIndex]?.name ?? c.positionKey,
      card_name: c.cardName,
      orientation: c.orientation,
    })),
  };
  const runner = opts.runner ?? getAiRunner();
  const req = {
    ...extractTask.buildExtractRequest(input, { userId: reading.userId, readingId }),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  const res = await runner.runObject(req);

  if (!res.ok) {
    await db
      .update(extractions)
      .set({ status: 'failed', errorClass: res.errorClass, completedAt: new Date() })
      .where(eq(extractions.id, extractionId));
    logger.info('memory.extraction.failed', {
      userId: reading.userId,
      objectId: readingId,
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

  // Materialise from the pending row first, then mark it complete and supersede the previous
  // current row in one transaction: a reader never sees a complete extraction without its
  // themes and mentions. Append-only: nothing is deleted (§7.2).
  let materialized: MaterializeResult;
  try {
    await db
      .update(extractions)
      .set({ payload: res.value })
      .where(eq(extractions.id, extractionId));
    materialized = await materializeReading(readingId, {
      extraction: { id: extractionId, payload: res.value },
    });
  } catch (err) {
    await db
      .update(extractions)
      .set({ status: 'failed', errorClass: 'materialize_error', completedAt: new Date() })
      .where(eq(extractions.id, extractionId));
    logger.warn('memory.extraction.materialize_failed', {
      userId: reading.userId,
      objectId: readingId,
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
          eq(extractions.objectType, 'reading'),
          eq(extractions.objectId, readingId),
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
    userId: reading.userId,
    objectType: 'reading',
    objectId: readingId,
    count: materialized.mentions,
  });
  return { status: 'complete', extractionId, supersededId: current?.id ?? null, materialized };
}
