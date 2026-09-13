import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { journeyMembers, journeys, readings } from '@/db/schema';
import { decideAssignment, scoreAffinity, type ObjectFeatures } from '@/domain/journeys/affinity';
import { logger } from '@/observability/logger';
import { loadReadingFeatures, type FeatureSet } from './features';

/**
 * Assignment of one reading to the user's existing journeys (docs/ALGORITHMS.md §2). For
 * every journey that can still grow (active or dormant, not merged) the reading is
 * scored against the live members; ≥ 0.70 becomes an `auto` member, 0.50–0.70 a `pending`
 * one the reading detail asks about, below that nothing. A row the reading already has in a
 * journey — whatever its state, including `removed` — is never re-decided here: only its
 * signals and reasons are refreshed, so a correction elsewhere cannot silently flip a
 * membership the user has looked at (the same rule Phase 06 applies to entity links).
 */

export interface AssignmentResult {
  readingId: string;
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

/** Live member reading ids per journey, one query for all of them. */
export async function loadMembersByJourney(
  journeyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (journeyIds.length === 0) return out;
  const rows = await platformDb()
    .select({ journeyId: journeyMembers.journeyId, objectId: journeyMembers.objectId })
    .from(journeyMembers)
    .innerJoin(readings, eq(readings.id, journeyMembers.objectId))
    .where(
      and(
        inArray(journeyMembers.journeyId, [...journeyIds]),
        eq(journeyMembers.objectType, 'reading'),
        inArray(journeyMembers.state, ['auto', 'confirmed']),
        isNull(readings.deletedAt),
      ),
    );
  for (const r of rows) out.set(r.journeyId, [...(out.get(r.journeyId) ?? []), r.objectId]);
  return out;
}

export async function assignReading(
  userId: string,
  readingId: string,
  preloaded?: { features?: FeatureSet },
): Promise<AssignmentResult> {
  const db = platformDb();
  const result: AssignmentResult = { readingId, added: [], touched: [] };
  const candidates = await loadGrowableJourneys(userId);
  if (candidates.length === 0) return result;
  const membersByJourney = await loadMembersByJourney(candidates.map((j) => j.id));
  const allIds = new Set<string>([readingId]);
  for (const ids of membersByJourney.values()) for (const id of ids) allIds.add(id);
  const set = preloaded?.features ?? (await loadReadingFeatures(userId, [...allIds]));
  const reading = set.features.get(readingId);
  if (!reading) return result;

  const existing = await db
    .select({
      id: journeyMembers.id,
      journeyId: journeyMembers.journeyId,
      state: journeyMembers.state,
    })
    .from(journeyMembers)
    .where(and(eq(journeyMembers.objectType, 'reading'), eq(journeyMembers.objectId, readingId)));
  const rowByJourney = new Map(existing.map((r) => [r.journeyId, r]));

  for (const j of candidates) {
    const memberIds = (membersByJourney.get(j.id) ?? []).filter((id) => id !== readingId);
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
        objectType: 'reading',
        objectId: readingId,
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
      objectType: 'reading',
      objectId: readingId,
      journeyId: j.id,
      state: decision,
    });
  }
  return result;
}
