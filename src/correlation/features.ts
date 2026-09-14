import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import {
  cards,
  entities,
  entityMentions,
  extractions,
  journeyMembers,
  journeys,
  lifeEvents,
  objectThemes,
  readingCards,
  readings,
  themes,
} from '@/db/schema';
import type { CorrelationObject, EvidenceEntity, Horizon } from '@/domain/correlation/score';
import { extractionPayloadSchema } from '@/domain/extraction/schema';
import { loadEmbeddingsFor } from '@/retrieval/vectors';

/**
 * Evidence bundles for the correlation engine (docs/ALGORITHMS.md §3), built from stored
 * rows in a fixed number of queries whatever the candidate count. Every entity and theme
 * here comes from an extraction of the user's own words, so its provenance is `user_text`;
 * nothing an interpretation or a summary produced is ever loaded (guard 2 is enforced twice:
 * here by construction and in the pure engine by filtering). A reading's horizon is the
 * timeframe its extraction found, or — the user's own statement — its revisit date. Since
 * Phase 09 each object carries its retrieval-document vector when one exists, so the engine's
 * `semantic_similarity` signal is available for embedded pairs (and renormalised out otherwise).
 */

export interface CorrelationFeatureSet {
  objects: Map<string, CorrelationObject>;
  entityLabels: Map<string, string>;
  themeLabels: Map<string, string>;
  journeyTitles: Map<string, string>;
  cardLabels: Map<string, string>;
}

export async function loadCorrelationFeatures(
  userId: string,
  ids: { readings: readonly string[]; events: readonly string[] },
): Promise<CorrelationFeatureSet> {
  const db = platformDb();
  const out: CorrelationFeatureSet = {
    objects: new Map(),
    entityLabels: new Map(),
    themeLabels: new Map(),
    journeyTitles: new Map(),
    cardLabels: new Map(),
  };
  const readingIds = [...ids.readings];
  const eventIds = [...ids.events];
  if (readingIds.length === 0 && eventIds.length === 0) return out;

  const [readingRows, eventRows] = await Promise.all([
    readingIds.length
      ? db
          .select({
            id: readings.id,
            occurredAt: readings.occurredAt,
            revisitAt: readings.revisitAt,
          })
          .from(readings)
          .where(
            and(
              eq(readings.userId, userId),
              isNull(readings.deletedAt),
              inArray(readings.id, readingIds),
            ),
          )
      : Promise.resolve([]),
    eventIds.length
      ? db
          .select({ id: lifeEvents.id, occurredOn: lifeEvents.occurredOn })
          .from(lifeEvents)
          .where(
            and(
              eq(lifeEvents.userId, userId),
              isNull(lifeEvents.deletedAt),
              inArray(lifeEvents.id, eventIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const liveReadingIds = readingRows.map((r) => r.id);
  const objectIds = [...liveReadingIds, ...eventRows.map((e) => e.id)];
  if (objectIds.length === 0) return out;

  const [mentionRows, themeRows, memberRows, cardRows, extractionRows, vectors] = await Promise.all(
    [
      db
        .select({
          objectId: entityMentions.objectId,
          entityId: entityMentions.entityId,
          resolution: entityMentions.resolution,
          label: entities.canonicalLabel,
          userConfirmed: entities.userConfirmed,
        })
        .from(entityMentions)
        .innerJoin(entities, eq(entities.id, entityMentions.entityId))
        .where(
          and(
            inArray(entityMentions.objectId, objectIds),
            inArray(entityMentions.resolution, ['auto', 'user', 'tentative']),
            eq(entities.status, 'active'),
          ),
        ),
      db
        .select({
          objectId: objectThemes.objectId,
          weight: objectThemes.weight,
          slug: themes.slug,
          label: themes.label,
        })
        .from(objectThemes)
        .innerJoin(themes, eq(themes.id, objectThemes.themeId))
        .where(inArray(objectThemes.objectId, objectIds)),
      db
        .select({
          objectId: journeyMembers.objectId,
          journeyId: journeyMembers.journeyId,
          state: journeyMembers.state,
          title: journeys.title,
        })
        .from(journeyMembers)
        .innerJoin(journeys, eq(journeys.id, journeyMembers.journeyId))
        .where(
          and(
            inArray(journeyMembers.objectId, objectIds),
            inArray(journeyMembers.state, ['auto', 'confirmed']),
            isNull(journeys.dismissedAt),
            isNull(journeys.mergedIntoId),
            ne(journeys.status, 'closed'),
          ),
        ),
      liveReadingIds.length
        ? db
            .select({
              readingId: readingCards.readingId,
              cardId: readingCards.cardId,
              name: cards.name,
            })
            .from(readingCards)
            .innerJoin(cards, eq(cards.id, readingCards.cardId))
            .where(inArray(readingCards.readingId, liveReadingIds))
        : Promise.resolve([]),
      liveReadingIds.length
        ? db
            .select({ objectId: extractions.objectId, payload: extractions.payload })
            .from(extractions)
            .where(
              and(
                eq(extractions.objectType, 'reading'),
                inArray(extractions.objectId, liveReadingIds),
                eq(extractions.status, 'complete'),
                isNull(extractions.supersededBy),
              ),
            )
        : Promise.resolve([]),
      loadEmbeddingsFor(userId, objectIds),
    ],
  );

  const entitiesBy = new Map<string, EvidenceEntity[]>();
  for (const m of mentionRows) {
    out.entityLabels.set(m.entityId, m.label);
    const list = entitiesBy.get(m.objectId) ?? [];
    if (!list.some((e) => e.id === m.entityId))
      list.push({
        id: m.entityId,
        resolution: m.resolution as EvidenceEntity['resolution'],
        userConfirmed: m.userConfirmed,
        provenance: 'user_text',
      });
    entitiesBy.set(m.objectId, list);
  }
  const themesBy = new Map<string, { slug: string; weight: number; provenance: 'user_text' }[]>();
  for (const t of themeRows) {
    out.themeLabels.set(t.slug, t.label);
    const list = themesBy.get(t.objectId) ?? [];
    list.push({ slug: t.slug, weight: Number(t.weight), provenance: 'user_text' });
    themesBy.set(t.objectId, list);
  }
  const journeysBy = new Map<string, { id: string; state: 'auto' | 'confirmed' }[]>();
  for (const m of memberRows) {
    out.journeyTitles.set(m.journeyId, m.title);
    const list = journeysBy.get(m.objectId) ?? [];
    list.push({ id: m.journeyId, state: m.state as 'auto' | 'confirmed' });
    journeysBy.set(m.objectId, list);
  }
  const cardsBy = new Map<string, string[]>();
  for (const c of cardRows) {
    out.cardLabels.set(c.cardId, c.name);
    cardsBy.set(c.readingId, [...(cardsBy.get(c.readingId) ?? []), c.cardId]);
  }
  const horizonBy = new Map<string, Horizon>();
  for (const x of extractionRows) {
    const parsed = extractionPayloadSchema.safeParse(x.payload);
    const tf = parsed.success ? parsed.data.timeframe : null;
    if (tf?.start && tf.end)
      horizonBy.set(x.objectId, { start: tf.start, end: tf.end, text: tf.text });
  }

  for (const r of readingRows) {
    const day = r.occurredAt.toISOString().slice(0, 10);
    const horizon =
      horizonBy.get(r.id) ??
      (r.revisitAt && r.revisitAt > r.occurredAt
        ? { start: day, end: r.revisitAt.toISOString().slice(0, 10), text: 'revisit' }
        : null);
    out.objects.set(r.id, {
      id: r.id,
      type: 'reading',
      occurredAt: r.occurredAt.toISOString(),
      entities: entitiesBy.get(r.id) ?? [],
      themes: themesBy.get(r.id) ?? [],
      journeys: journeysBy.get(r.id) ?? [],
      cards: cardsBy.get(r.id) ?? [],
      horizon,
      ...(vectors.has(r.id) ? { embedding: vectors.get(r.id) } : {}),
    });
  }
  for (const e of eventRows) {
    out.objects.set(e.id, {
      id: e.id,
      type: 'life_event',
      occurredAt: `${e.occurredOn}T12:00:00.000Z`,
      entities: entitiesBy.get(e.id) ?? [],
      themes: themesBy.get(e.id) ?? [],
      journeys: journeysBy.get(e.id) ?? [],
      ...(vectors.has(e.id) ? { embedding: vectors.get(e.id) } : {}),
    });
  }
  return out;
}

/** Readings (for an event) or events (for a reading) within the candidate window, closest first. */
export async function loadCandidateIds(
  userId: string,
  object: { type: 'reading' | 'life_event'; at: Date },
  windowDays: number,
  limit: number,
): Promise<string[]> {
  const db = platformDb();
  const from = new Date(object.at.getTime() - windowDays * 86_400_000);
  const to = new Date(object.at.getTime() + windowDays * 86_400_000);
  if (object.type === 'life_event') {
    const rows = await db
      .select({ id: readings.id })
      .from(readings)
      .where(
        and(
          eq(readings.userId, userId),
          isNull(readings.deletedAt),
          sql`${readings.occurredAt} between ${from.toISOString()}::timestamptz and ${to.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(
        sql`abs(extract(epoch from ${readings.occurredAt} - ${object.at.toISOString()}::timestamptz))`,
      )
      .limit(limit);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: lifeEvents.id })
    .from(lifeEvents)
    .where(
      and(
        eq(lifeEvents.userId, userId),
        isNull(lifeEvents.deletedAt),
        sql`${lifeEvents.occurredOn} between ${from.toISOString().slice(0, 10)}::date and ${to.toISOString().slice(0, 10)}::date`,
      ),
    )
    .orderBy(sql`abs(${lifeEvents.occurredOn} - ${object.at.toISOString().slice(0, 10)}::date)`)
    .limit(limit);
  return rows.map((r) => r.id);
}
