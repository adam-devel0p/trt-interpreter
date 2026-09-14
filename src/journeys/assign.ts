import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { journeyMembers, journeys, lifeEvents, readings } from '@/db/schema';
import { decideAssignment, scoreAffinity, type ObjectFeatures } from '@/domain/journeys/affinity';
import { logger } from '@/observability/logger';
import { loadObjectFeatures, type FeatureSet } from './features';

/**
 * Assignment of one reading or life event to the user's existing journeys
 * (docs/ALGORITHMS.md §2). For every journey that can still grow (active or dormant, not
 * merged) the object is scored against the live members; ≥ 0.70 becomes an `auto` member,
 * 0.50–0.70 a `pending` one the detail screen asks about, below that nothing. A row the
 * object already has in a journey — whatever its state, including `removed` — is never
 * re-decided here: only its signals and reasons are refreshed, so a correction elsewhere
 * cannot silently flip a membership the user has looked at (the same rule Phase 06 applies
 * to entity links). Events join journeys by assignment only; discovery seeds from readings.
 */

export type MemberObjectType = 'reading' | 'life_event';

export interface AssignmentResult {
  readingId: string;
  objectType: MemberObjectType;
  objectId: string;
  added: { journeyId: string; state: 'auto' | 'pending'; score: number }[];
  /** Every journey whose rows changed (for a refresh). */
  touched: string[];
}

/**
 * Journeys a reading can be filed into: active or dormant, not merged away. A `suggested`
 * journey is a hypothesis the user has not accepted — it never gathers readings by
 * assignment (discovery may still grow or promote it); a closed one is finished.
 */
export async function loadGrowableJourneys(userId: string) {
  return platformDb()
    .select({ id: journeys.id, status: journeys.status })
    .from(journeys)
    .where(
      and(
        eq(journeys.userId, userId),
        isNull(journeys.dismissedAt),
        isNull(journeys.mergedIntoId),
        inArray(journeys.status, ['active', 'dormant']),
      ),
    );
}

export interface LiveMembers {
  readings: string[];
  events: string[];
}

/** Live member ids per journey (readings and events, not soft-deleted), one query for all. */
export async function loadMembersByJourney(
  journeyIds: readonly string[],
): Promise<Map<string, LiveMembers>> {
  const out = new Map<string, LiveMembers>();
  if (journeyIds.length === 0) return out;
  const rows = await platformDb()
    .select({
      journeyId: journeyMembers.journeyId,
      objectType: journeyMembers.objectType,
      objectId: journeyMembers.objectId,
    })
    .from(journeyMembers)
    .leftJoin(
      readings,
      and(eq(journeyMembers.objectType, 'reading'), eq(readings.id, journeyMembers.objectId)),
    )
    .leftJoin(
      lifeEvents,
      and(eq(journeyMembers.objectType, 'life_event'), eq(lifeEvents.id, journeyMembers.objectId)),
    )
    .where(
      and(
        inArray(journeyMembers.journeyId, [...journeyIds]),
        inArray(journeyMembers.state, ['auto', 'confirmed']),
        sql`((${journeyMembers.objectType} = 'reading' and ${readings.id} is not null and ${readings.deletedAt} is null) or (${journeyMembers.objectType} = 'life_event' and ${lifeEvents.id} is not null and ${lifeEvents.deletedAt} is null))`,
      ),
    );
  for (const r of rows) {
    const m = out.get(r.journeyId) ?? { readings: [], events: [] };
    (r.objectType === 'reading' ? m.readings : m.events).push(r.objectId);
    out.set(r.journeyId, m);
  }
  return out;
}

export async function assignReading(
  userId: string,
  readingId: string,
  preloaded?: { features?: FeatureSet },
): Promise<AssignmentResult> {
  return assignObject(userId, 'reading', readingId, preloaded);
}

export async function assignObject(
  userId: string,
  objectType: MemberObjectType,
  objectId: string,
  preloaded?: { features?: FeatureSet },
): Promise<AssignmentResult> {
  const db = platformDb();
  const readingId = objectId;
  const result: AssignmentResult = { readingId, objectType, objectId, added: [], touched: [] };
  const candidates = await loadGrowableJourneys(userId);
  if (candidates.length === 0) return result;
  const membersByJourney = await loadMembersByJourney(candidates.map((j) => j.id));
  const readingIds = new Set<string>(objectType === 'reading' ? [objectId] : []);
  const eventIds = new Set<string>(objectType === 'life_event' ? [objectId] : []);
  for (const m of membersByJourney.values()) {
    for (const id of m.readings) readingIds.add(id);
    for (const id of m.events) eventIds.add(id);
  }
  const set =
    preloaded?.features ??
    (await loadObjectFeatures(userId, { readings: [...readingIds], events: [...eventIds] }));
  const reading = set.features.get(objectId);
  if (!reading) return result;

  const existing = await db
    .select({
      id: journeyMembers.id,
      journeyId: journeyMembers.journeyId,
      state: journeyMembers.state,
    })
    .from(journeyMembers)
    .where(and(eq(journeyMembers.objectType, objectType), eq(journeyMembers.objectId, objectId)));
  const rowByJourney = new Map(existing.map((r) => [r.journeyId, r]));

  for (const j of candidates) {
    const live = membersByJourney.get(j.id) ?? { readings: [], events: [] };
    const memberIds = [...live.readings, ...live.events].filter((id) => id !== objectId);
    const members = memberIds
      .map((id) => set.features.get(id))
      .filter((m): m is ObjectFeatures => !!m);
    if (members.length === 0) continue;
    const aff = scoreAffinity(
      reading,
      { id: j.id, members },
      { entityLabels: set.entityLabels, themeLabels: set.themeLabels },
    );
    const prior = rowByJourney.get(j.id);
    if (prior) {
      if (prior.state === 'auto' || prior.state === 'pending') {
        await db
          .update(journeyMembers)
          .set({ confidence: aff.score.toFixed(3), signals: aff.signals, reasons: aff.reasons })
          .where(eq(journeyMembers.id, prior.id));
      }
      continue;
    }
    const decision = decideAssignment(aff.score);
    if (decision === 'none') continue;
    await db
      .insert(journeyMembers)
      .values({
        userId,
        journeyId: j.id,
        objectType,
        objectId,
        confidence: aff.score.toFixed(3),
        createdBy: 'rule',
        state: decision,
        signals: aff.signals,
        reasons: aff.reasons,
      })
      .onConflictDoNothing();
    result.added.push({ journeyId: j.id, state: decision, score: aff.score });
    result.touched.push(j.id);
    logger.info('journeys.member_assigned', {
      userId,
      objectType,
      objectId,
      journeyId: j.id,
      state: decision,
    });
  }
  return result;
}
