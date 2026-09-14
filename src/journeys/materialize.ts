import 'server-only';
import { eq } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { lifeEvents, profiles, readings } from '@/db/schema';
import { flagForUser } from '@/flags/server';
import { enqueue } from '@/jobs/enqueue';
import { errorClassOf, logger } from '@/observability/logger';
import { assignObject, type MemberObjectType } from './assign';
import { discoverJourneys } from './discover';
import { refreshJourneys } from './refresh';

/**
 * The journey step of materialisation (spec §6.5, FR-10). Runs after a reading's structured
 * memory is materialised — after extraction, reprocess and every correction — and is
 * idempotent and model-free: assign the reading to the journeys it fits, look for new
 * journeys among what is still unassigned, refresh what changed. Gated by the
 * `journey_autocreate` flag (env default off; per-user rollout like `ai_extraction`).
 * Naming is a separate, consent-gated job (`propose_journey`) through the lazy registry.
 * Failures are logged by class and never fail the caller: journeys are derived; the reading
 * and its memory are already saved.
 */

export interface JourneyMaterializeResult {
  readingId: string;
  objectType: MemberObjectType;
  objectId: string;
  skipped?: 'flag' | 'missing';
  assigned: number;
  created: number;
}

export async function materializeJourneysForReading(
  readingId: string,
): Promise<JourneyMaterializeResult> {
  return materializeJourneysForObject('reading', readingId);
}

/**
 * Readings assign and may seed new journeys; a life event (Phase 08) assigns to existing
 * journeys only — journeys are formed from what a person asks about, and events join them.
 */
export async function materializeJourneysForObject(
  objectType: MemberObjectType,
  objectId: string,
): Promise<JourneyMaterializeResult> {
  const db = platformDb();
  const empty: JourneyMaterializeResult = {
    readingId: objectId,
    objectType,
    objectId,
    assigned: 0,
    created: 0,
  };
  const [object] =
    objectType === 'reading'
      ? await db
          .select({ userId: readings.userId, deletedAt: readings.deletedAt })
          .from(readings)
          .where(eq(readings.id, objectId))
          .limit(1)
      : await db
          .select({ userId: lifeEvents.userId, deletedAt: lifeEvents.deletedAt })
          .from(lifeEvents)
          .where(eq(lifeEvents.id, objectId))
          .limit(1);
  if (!object || object.deletedAt) return { ...empty, skipped: 'missing' };
  const userId = object.userId;
  if (!(await flagForUser('journey_autocreate', userId))) return { ...empty, skipped: 'flag' };

  const assignment = await assignObject(userId, objectType, objectId);
  const discovery =
    objectType === 'reading' ? await discoverJourneys(userId) : { created: [], grown: [] };
  await refreshJourneys([
    ...assignment.touched,
    ...discovery.created.map((c) => c.journeyId),
    ...discovery.grown.map((g) => g.journeyId),
  ]);

  if (discovery.created.length) {
    const [profile] = await db
      .select({ aiConsentAt: profiles.aiConsentAt })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (profile?.aiConsentAt) {
      for (const c of discovery.created) {
        try {
          await enqueue('propose_journey', { journeyId: c.journeyId }, { userId, dedupe: true });
        } catch (err) {
          logger.warn('journeys.propose_enqueue_failed', {
            userId,
            journeyId: c.journeyId,
            errorClass: errorClassOf(err),
          });
        }
      }
    }
  }
  return {
    ...empty,
    assigned: assignment.added.length,
    created: discovery.created.length,
  };
}

/** Wrapper for the memory materialiser: never throws. */
export async function materializeJourneysSafely(
  objectType: MemberObjectType,
  objectId: string,
): Promise<void> {
  try {
    await materializeJourneysForObject(objectType, objectId);
  } catch (err) {
    logger.warn('journeys.materialize_failed', {
      objectType,
      objectId,
      errorClass: errorClassOf(err),
    });
  }
}
