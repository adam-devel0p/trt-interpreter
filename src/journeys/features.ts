import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { entities, entityMentions, lifeEvents, objectThemes, readings, themes } from '@/db/schema';
import type { ObjectFeatures } from '@/domain/journeys/affinity';
import { CONTEXT_RESOLUTIONS } from '@/memory/context';

/**
 * Feature loading for journey affinity (docs/ALGORITHMS.md §2). Builds the pure
 * `ObjectFeatures` records from stored rows in a fixed number of queries whatever the
 * object count — one per table with `inArray` — so a 100-member journey costs the same round
 * trips as a 3-member one. Entities come from `auto` and `user` mentions only (the same list
 * prompts may use, `src/memory/context.ts`): a tentative link never files a reading.
 * Phase 08: life events are objects of the same shape (no question; the date is their day).
 */

export interface FeatureSet {
  features: Map<string, ObjectFeatures>;
  entityLabels: Map<string, string>;
  themeLabels: Map<string, string>;
  /** slug → theme id, for writing progression rows. */
  themeIds: Map<string, string>;
}

export interface ObjectIds {
  readings?: readonly string[];
  events?: readonly string[];
}

const EMPTY = (): FeatureSet => ({
  features: new Map(),
  entityLabels: new Map(),
  themeLabels: new Map(),
  themeIds: new Map(),
});

/** Readings only (the discovery pool); `undefined` = every live reading of the user. */
export async function loadReadingFeatures(
  userId: string,
  readingIds?: readonly string[],
): Promise<FeatureSet> {
  if (readingIds && readingIds.length === 0) return EMPTY();
  return loadObjectFeatures(userId, { readings: readingIds ?? null });
}

/** Readings and events by id. A `null` reading list means every live reading. */
export async function loadObjectFeatures(
  userId: string,
  ids: { readings?: readonly string[] | null; events?: readonly string[] },
): Promise<FeatureSet> {
  const db = platformDb();
  const wantReadings = ids.readings === null || (ids.readings?.length ?? 0) > 0;
  const wantEvents = (ids.events?.length ?? 0) > 0;
  if (!wantReadings && !wantEvents) return EMPTY();

  const [readingRows, eventRows] = await Promise.all([
    wantReadings
      ? db
          .select({
            id: readings.id,
            occurredAt: readings.occurredAt,
            question: readings.question,
            isOpenReflection: readings.isOpenReflection,
          })
          .from(readings)
          .where(
            and(
              eq(readings.userId, userId),
              isNull(readings.deletedAt),
              ids.readings ? inArray(readings.id, [...ids.readings]) : sql`true`,
            ),
          )
      : Promise.resolve([]),
    wantEvents
      ? db
          .select({ id: lifeEvents.id, occurredOn: lifeEvents.occurredOn })
          .from(lifeEvents)
          .where(
            and(
              eq(lifeEvents.userId, userId),
              isNull(lifeEvents.deletedAt),
              inArray(lifeEvents.id, [...ids.events!]),
            ),
          )
      : Promise.resolve([]),
  ]);
  const objectIds = [...readingRows.map((r) => r.id), ...eventRows.map((e) => e.id)];
  if (objectIds.length === 0) return EMPTY();

  const [mentionRows, themeRows] = await Promise.all([
    db
      .select({
        objectId: entityMentions.objectId,
        entityId: entityMentions.entityId,
        label: entities.canonicalLabel,
      })
      .from(entityMentions)
      .innerJoin(entities, eq(entities.id, entityMentions.entityId))
      .where(
        and(
          inArray(entityMentions.objectId, objectIds),
          inArray(entityMentions.resolution, [...CONTEXT_RESOLUTIONS]),
          eq(entities.status, 'active'),
        ),
      ),
    db
      .select({
        objectId: objectThemes.objectId,
        themeId: objectThemes.themeId,
        weight: objectThemes.weight,
        slug: themes.slug,
        label: themes.label,
      })
      .from(objectThemes)
      .innerJoin(themes, eq(themes.id, objectThemes.themeId))
      .where(inArray(objectThemes.objectId, objectIds)),
  ]);

  const entityIds = new Map<string, string[]>();
  const entityLabels = new Map<string, string>();
  for (const m of mentionRows) {
    entityLabels.set(m.entityId, m.label);
    const list = entityIds.get(m.objectId) ?? [];
    if (!list.includes(m.entityId)) list.push(m.entityId);
    entityIds.set(m.objectId, list);
  }
  const themeList = new Map<string, { slug: string; weight: number }[]>();
  const themeLabels = new Map<string, string>();
  const themeIds = new Map<string, string>();
  for (const t of themeRows) {
    themeLabels.set(t.slug, t.label);
    themeIds.set(t.slug, t.themeId);
    const list = themeList.get(t.objectId) ?? [];
    list.push({ slug: t.slug, weight: Number(t.weight) });
    themeList.set(t.objectId, list);
  }

  const features = new Map<string, ObjectFeatures>();
  for (const r of readingRows) {
    features.set(r.id, {
      id: r.id,
      type: 'reading',
      occurredAt: r.occurredAt.toISOString(),
      entityIds: entityIds.get(r.id) ?? [],
      themes: themeList.get(r.id) ?? [],
      question: r.isOpenReflection ? null : r.question,
    });
  }
  for (const e of eventRows) {
    features.set(e.id, {
      id: e.id,
      type: 'life_event',
      occurredAt: `${e.occurredOn}T12:00:00.000Z`,
      entityIds: entityIds.get(e.id) ?? [],
      themes: themeList.get(e.id) ?? [],
      question: null,
    });
  }
  return { features, entityLabels, themeLabels, themeIds };
}
