import 'server-only';
import { and, eq, isNull, ne, notExists, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { journeyMembers, journeys, readings } from '@/db/schema';
import { discoverClusters, type Cluster } from '@/domain/journeys/cluster';
import { placeholderTitle } from '@/domain/journeys/titles';
import { logger } from '@/observability/logger';
import { loadReadingFeatures } from './features';

/**
 * Journey creation (docs/ALGORITHMS.md §2 "Journey creation"). Runs over the user's
 * readings that belong to no growable journey, clusters them with the pure algorithm, and
 * writes each cluster as a journey with its members: `active` when ≥ 3 objects share a
 * resolved entity or a stable theme pair across ≥ 14 days, `suggested` otherwise. Titles are
 * deterministic placeholders until `propose_journey` runs; the member sets of dismissed
 * journeys are passed in so a dismissal is never re-suggested (§19).
 */

export interface DiscoveryResult {
  created: { journeyId: string; status: 'active' | 'suggested'; members: number }[];
  /** Open suggestions that gained members (and possibly became active). */
  grown: { journeyId: string; status: 'active' | 'suggested'; added: number }[];
}

/**
 * Readings not filed in an active, dormant or closed journey (any state but `removed`;
 * `pending` counts — an open "part of this?" question must not also seed a second
 * journey). Members of *suggested* journeys stay in the pool: a hypothesis can be grown or
 * promoted by later evidence, and a weak cluster that merely repeats one is skipped.
 */
async function poolReadingIds(userId: string): Promise<string[]> {
  const db = platformDb();
  const rows = await db
    .select({ id: readings.id })
    .from(readings)
    .where(
      and(
        eq(readings.userId, userId),
        isNull(readings.deletedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(journeyMembers)
            .innerJoin(journeys, eq(journeys.id, journeyMembers.journeyId))
            .where(
              and(
                eq(journeyMembers.objectType, 'reading'),
                eq(journeyMembers.objectId, readings.id),
                ne(journeyMembers.state, 'removed'),
                isNull(journeys.mergedIntoId),
                ne(journeys.status, 'suggested'),
              ),
            ),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/** Member sets of suggested journeys, split by whether the user dismissed them. */
async function suggestedMemberSets(
  userId: string,
): Promise<{ open: Map<string, string[]>; dismissed: string[][] }> {
  const db = platformDb();
  const rows = await db
    .select({
      journeyId: journeyMembers.journeyId,
      objectId: journeyMembers.objectId,
      dismissedAt: journeys.dismissedAt,
    })
    .from(journeyMembers)
    .innerJoin(journeys, eq(journeys.id, journeyMembers.journeyId))
    .where(
      and(
        eq(journeys.userId, userId),
        eq(journeys.status, 'suggested'),
        isNull(journeys.mergedIntoId),
        ne(journeyMembers.state, 'removed'),
      ),
    );
  const open = new Map<string, string[]>();
  const dismissedSets = new Map<string, string[]>();
  for (const r of rows) {
    const target = r.dismissedAt ? dismissedSets : open;
    target.set(r.journeyId, [...(target.get(r.journeyId) ?? []), r.objectId]);
  }
  return { open, dismissed: [...dismissedSets.values()] };
}

export async function discoverJourneys(userId: string): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { created: [], grown: [] };
  const ids = await poolReadingIds(userId);
  if (ids.length < 2) return result;
  const set = await loadReadingFeatures(userId, ids);
  // Nothing to cluster on without at least one entity or theme.
  const objects = [...set.features.values()].filter(
    (f) => f.entityIds.length > 0 || f.themes.length > 0,
  );
  if (objects.length < 2) return result;
  const suggested = await suggestedMemberSets(userId);
  const clusters = discoverClusters(objects, {
    entityLabels: set.entityLabels,
    themeLabels: set.themeLabels,
    dismissed: suggested.dismissed,
  });
  for (const c of clusters) {
    const members = new Set(c.memberIds);
    // An open suggestion this cluster contains is grown (and promoted if now strong)
    // rather than duplicated; a cluster that adds nothing to one is skipped.
    const covering = [...suggested.open].find(([, ids]) => ids.every((id) => members.has(id)));
    if (covering) {
      const [journeyId, existing] = covering;
      const added = c.memberIds.filter((id) => !existing.includes(id));
      if (added.length === 0 && c.status === 'suggested') continue;
      await growSuggested(userId, journeyId, added, c);
      suggested.open.delete(journeyId);
      result.grown.push({ journeyId, status: c.status, added: added.length });
      logger.info('journeys.grown', { userId, journeyId, status: c.status, count: added.length });
      continue;
    }
    if ([...suggested.open.values()].some((ids) => c.memberIds.every((id) => ids.includes(id))))
      continue;
    const id = await writeCluster(userId, c, set.entityLabels, set.themeLabels, set.features);
    result.created.push({ journeyId: id, status: c.status, members: c.memberIds.length });
    logger.info('journeys.created', {
      userId,
      journeyId: id,
      status: c.status,
      count: c.memberIds.length,
    });
  }
  return result;
}

async function growSuggested(
  userId: string,
  journeyId: string,
  added: string[],
  c: Cluster,
): Promise<void> {
  const db = platformDb();
  await db.transaction(async (tx) => {
    if (added.length)
      await tx
        .insert(journeyMembers)
        .values(
          added.map((objectId) => ({
            userId,
            journeyId,
            objectType: 'reading',
            objectId,
            confidence: c.meanAffinity.toFixed(3),
            createdBy: 'rule' as const,
            state: 'auto',
            signals: null,
            reasons: c.reasons,
          })),
        )
        .onConflictDoNothing();
    await tx
      .update(journeys)
      .set({
        status: c.status,
        confidence: c.meanAffinity.toFixed(3),
        reasons: c.reasons,
      })
      .where(and(eq(journeys.id, journeyId), eq(journeys.status, 'suggested')));
  });
}

async function writeCluster(
  userId: string,
  c: Cluster,
  entityLabels: Map<string, string>,
  themeLabels: Map<string, string>,
  features: Map<
    string,
    { occurredAt: string; themes: readonly { slug: string; weight: number }[] }
  >,
): Promise<string> {
  const db = platformDb();
  const weights = new Map<string, number>();
  for (const id of c.memberIds)
    for (const t of features.get(id)?.themes ?? [])
      weights.set(t.slug, (weights.get(t.slug) ?? 0) + t.weight);
  const topThemes = [...weights]
    .sort(([, a], [, b]) => b - a)
    .map(([slug]) => themeLabels.get(slug) ?? slug);
  const title = placeholderTitle({
    sharedEntityLabels: c.sharedEntityIds.map((e) => entityLabels.get(e) ?? ''),
    sharedThemeLabels: c.sharedThemeSlugs.map((s) => themeLabels.get(s) ?? s),
    topThemeLabels: topThemes,
  });
  const dates = c.memberIds.map((id) => Date.parse(features.get(id)!.occurredAt));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(journeys)
      .values({
        userId,
        title,
        titleSource: 'rule',
        status: c.status,
        startedAt: new Date(Math.min(...dates)),
        lastActivityAt: new Date(Math.max(...dates)),
        confidence: c.meanAffinity.toFixed(3),
        createdBy: 'rule',
        reasons: c.reasons,
        userConfirmed: false,
      })
      .returning({ id: journeys.id });
    await tx.insert(journeyMembers).values(
      c.memberIds.map((objectId) => ({
        userId,
        journeyId: row!.id,
        objectType: 'reading',
        objectId,
        confidence: c.meanAffinity.toFixed(3),
        createdBy: 'rule' as const,
        state: 'auto',
        signals: null,
        reasons: c.reasons,
      })),
    );
    return row!.id;
  });
}
