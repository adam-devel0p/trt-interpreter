import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { journeyMembers, journeys, journeyThemeProgression, readings } from '@/db/schema';
import { classifyCluster } from '@/domain/journeys/cluster';
import { themeProgression } from '@/domain/journeys/progression';
import { DORMANT_AFTER_DAYS } from '@/domain/journeys/thresholds';
import { loadReadingFeatures } from './features';

/**
 * Recompute what a journey derives from its live members: the activity window, the
 * active ⇄ dormant status, and the theme progression steps (FR-17) — every step with its
 * `source_object_ids`, so a deleted reading drops out of the evidence the next time this
 * runs (the purge job calls it). Idempotent, model-free, service role (an assignment step or
 * a purge has no session); user actions call it after their own RLS-scoped write.
 */

const DAY_MS = 86_400_000;

export interface RefreshResult {
  journeyId: string;
  members: number;
  progressionSteps: number;
  status: string;
}

/** Live members of a journey: `auto` or `confirmed` (a pending question is not yet part of it), reading not soft-deleted. */
export async function liveMemberReadingIds(journeyId: string): Promise<string[]> {
  const rows = await platformDb()
    .select({ objectId: journeyMembers.objectId })
    .from(journeyMembers)
    .innerJoin(readings, eq(readings.id, journeyMembers.objectId))
    .where(
      and(
        eq(journeyMembers.journeyId, journeyId),
        eq(journeyMembers.objectType, 'reading'),
        inArray(journeyMembers.state, ['auto', 'confirmed']),
        isNull(readings.deletedAt),
      ),
    );
  return rows.map((r) => r.objectId);
}

export async function refreshJourney(
  journeyId: string,
  opts: { now?: Date } = {},
): Promise<RefreshResult | null> {
  const db = platformDb();
  const [journey] = await db.select().from(journeys).where(eq(journeys.id, journeyId)).limit(1);
  if (!journey) return null;
  const now = opts.now ?? new Date();
  const ids = await liveMemberReadingIds(journeyId);
  const { features, themeIds } = await loadReadingFeatures(journey.userId, ids);
  const members = [...features.values()];

  const dates = members.map((m) => Date.parse(m.occurredAt));
  const startedAt = dates.length ? new Date(Math.min(...dates)) : journey.startedAt;
  const lastActivityAt = dates.length ? new Date(Math.max(...dates)) : journey.lastActivityAt;
  let status = journey.status;
  if (!journey.mergedIntoId && (status === 'active' || status === 'dormant')) {
    const idle = (now.getTime() - lastActivityAt.getTime()) / DAY_MS;
    status = idle > DORMANT_AFTER_DAYS ? 'dormant' : 'active';
  }
  // A suggestion that has since gathered enough evidence (three objects across two weeks
  // sharing an entity or a theme pair) becomes an ordinary journey; a dismissed one never does.
  if (status === 'suggested' && !journey.dismissedAt && members.length >= 3) {
    if (classifyCluster(members, Number(journey.confidence)).status === 'active') status = 'active';
  }

  const steps = themeProgression(
    members.map((m) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      themes: m.themes.map((t) => ({ slug: t.slug, label: t.slug, weight: t.weight })),
    })),
  ).filter((s) => themeIds.has(s.slug));

  await db.transaction(async (tx) => {
    await tx
      .update(journeys)
      .set({ startedAt, lastActivityAt, status })
      .where(eq(journeys.id, journeyId));
    await tx
      .delete(journeyThemeProgression)
      .where(eq(journeyThemeProgression.journeyId, journeyId));
    if (steps.length)
      await tx.insert(journeyThemeProgression).values(
        steps.map((s) => ({
          userId: journey.userId,
          journeyId,
          sequenceIndex: s.sequenceIndex,
          themeId: themeIds.get(s.slug)!,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          sourceObjectIds: s.sourceObjectIds,
        })),
      );
  });
  return { journeyId, members: members.length, progressionSteps: steps.length, status };
}

export async function refreshJourneys(journeyIds: readonly string[]): Promise<void> {
  for (const id of new Set(journeyIds)) await refreshJourney(id);
}

/** Journeys a set of readings belong to (any state but removed) — the ones a purge touches. */
export async function journeysOfReadings(readingIds: readonly string[]): Promise<string[]> {
  if (readingIds.length === 0) return [];
  const rows = await platformDb()
    .select({ journeyId: journeyMembers.journeyId })
    .from(journeyMembers)
    .where(
      and(
        eq(journeyMembers.objectType, 'reading'),
        inArray(journeyMembers.objectId, [...readingIds]),
      ),
    );
  return [...new Set(rows.map((r) => r.journeyId))];
}
