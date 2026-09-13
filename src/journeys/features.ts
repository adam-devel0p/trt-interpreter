import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { entities, entityMentions, objectThemes, readings, themes } from '@/db/schema';
import type { ObjectFeatures } from '@/domain/journeys/affinity';
import { CONTEXT_RESOLUTIONS } from '@/memory/context';

/**
 * Feature loading for journey affinity (docs/ALGORITHMS.md §2). Builds the pure
 * `ObjectFeatures` records from stored rows in a fixed number of queries whatever the
 * object count — one per table with `inArray` — so a 100-member journey costs the same round
 * trips as a 3-member one. Entities come from `auto` and `user` mentions only (the same list
 * prompts may use, `src/memory/context.ts`): a tentative link never files a reading.
 */

export interface FeatureSet {
  features: Map<string, ObjectFeatures>;
  entityLabels: Map<string, string>;
  themeLabels: Map<string, string>;
  /** slug → theme id, for writing progression rows. */
  themeIds: Map<string, string>;
}

export async function loadReadingFeatures(
  userId: string,
  readingIds?: readonly string[],
): Promise<FeatureSet> {
  const db = platformDb();
  const empty: FeatureSet = {
    features: new Map(),
    entityLabels: new Map(),
    themeLabels: new Map(),
    themeIds: new Map(),
  };
  if (readingIds && readingIds.length === 0) return empty;
  const rows = await db
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
        readingIds ? inArray(readings.id, [...readingIds]) : sql`true`,
      ),
    );
  if (rows.length === 0) return empty;
  const ids = rows.map((r) => r.id);

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
          eq(entityMentions.objectType, 'reading'),
          inArray(entityMentions.objectId, ids),
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
      .where(and(eq(objectThemes.objectType, 'reading'), inArray(objectThemes.objectId, ids))),
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
  for (const r of rows) {
    features.set(r.id, {
      id: r.id,
      type: 'reading',
      occurredAt: r.occurredAt.toISOString(),
      entityIds: entityIds.get(r.id) ?? [],
      themes: themeList.get(r.id) ?? [],
      question: r.isOpenReflection ? null : r.question,
    });
  }
  return { features, entityLabels, themeLabels, themeIds };
}
