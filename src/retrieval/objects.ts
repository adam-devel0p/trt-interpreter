import 'server-only';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import {
  cards,
  decks,
  entities,
  entityMentions,
  journeyMembers,
  journeys,
  lifeEvents,
  links,
  objectThemes,
  outcomes,
  predictions,
  readingCards,
  readings,
  spreads,
  themes,
} from '@/db/schema';
import { eventTypeLabel } from '@/domain/events/types';
import { CONTEXT_RESOLUTIONS } from '@/memory/context';
import { OUTCOME_SHORT, type OutcomeStatus } from '@/domain/outcomes/followUp';
import { LIFE_AREAS } from '@/domain/readings/types';
import type { CiteableLinkState } from '@/domain/retrieval/evidence';

/**
 * One loader for everything retrieval needs to know about a reading or a life event, in a
 * fixed number of queries whatever the id count (one per table with `inArray`, like the
 * correlation and journey feature loaders). It feeds the retrieval-document builder (one
 * object) and the Ask evidence package (up to a few dozen). Every read is scoped by
 * `user_id`; soft-deleted objects are not returned; entities come from `auto` / `user`
 * mentions only (a tentative mention is never a fact); links are the citeable states only.
 * Service role by design — jobs have no session and the Ask route has already verified the
 * user whose ids it passes.
 */

export type HistoryObjectType = 'reading' | 'life_event';

export interface HistoryObject {
  id: string;
  type: HistoryObjectType;
  userId: string;
  /** ISO instant (events: midday UTC on their day). */
  occurredAt: string;
  /** ISO date. */
  date: string;
  /** The question or the event sentence; null for an open reflection. */
  title: string | null;
  /** The user's note, if any. Never embedded; excerpted for the answer prompt only. */
  notes: string | null;
  lifeAreaKey: string | null;
  lifeAreaLabel: string | null;
  eventTypeLabel: string | null;
  deckName: string | null;
  cards: { name: string; orientation: 'upright' | 'reversed'; position: string | null }[];
  /** Theme labels, strongest first. */
  themes: string[];
  /** Canonical labels of resolved entities. */
  entities: string[];
  entityIds: string[];
  journeyTitles: string[];
  journeyIds: string[];
  possibilities: string[];
  timeframe: string | null;
  followUp: string | null;
  outcomes: {
    status: string;
    note: string | null;
    recordedOn: string;
    eventTitle: string | null;
  }[];
  links: {
    state: CiteableLinkState;
    otherType: HistoryObjectType;
    otherId: string;
    otherTitle: string;
    otherDate: string;
  }[];
}

const lifeAreaLabel = (key: string | null) =>
  key ? (LIFE_AREAS.find((a) => a.key === key)?.label ?? key) : null;

const dayOf = (iso: string) => iso.slice(0, 10);
const eventInstant = (occurredOn: string) => `${occurredOn}T12:00:00.000Z`;

export async function loadHistoryObjects(
  userId: string,
  ids: { readings?: readonly string[]; events?: readonly string[] },
): Promise<Map<string, HistoryObject>> {
  const db = platformDb();
  const readingIds = [...new Set(ids.readings ?? [])];
  const eventIds = [...new Set(ids.events ?? [])];
  const out = new Map<string, HistoryObject>();
  if (readingIds.length === 0 && eventIds.length === 0) return out;

  const [readingRows, eventRows] = await Promise.all([
    readingIds.length
      ? db
          .select({
            id: readings.id,
            occurredAt: readings.occurredAt,
            question: readings.question,
            isOpenReflection: readings.isOpenReflection,
            notes: readings.userNotes,
            lifeArea: readings.lifeArea,
            followUp: readings.followUpStatus,
            spreadId: readings.spreadId,
            deckName: decks.name,
          })
          .from(readings)
          .innerJoin(decks, eq(decks.id, readings.deckId))
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
          .select({
            id: lifeEvents.id,
            occurredOn: lifeEvents.occurredOn,
            description: lifeEvents.description,
            note: lifeEvents.note,
            lifeArea: lifeEvents.lifeArea,
            eventType: lifeEvents.eventType,
          })
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
  const liveEventIds = eventRows.map((e) => e.id);
  const objectIds = [...liveReadingIds, ...liveEventIds];
  if (objectIds.length === 0) return out;
  const spreadIds = [...new Set(readingRows.map((r) => r.spreadId))];

  const [
    cardRows,
    spreadRows,
    themeRows,
    mentionRows,
    memberRows,
    predictionRows,
    outcomeRows,
    linkRows,
  ] = await Promise.all([
    liveReadingIds.length
      ? db
          .select({
            readingId: readingCards.readingId,
            positionIndex: readingCards.positionIndex,
            positionKey: readingCards.positionKey,
            orientation: readingCards.orientation,
            name: cards.name,
          })
          .from(readingCards)
          .innerJoin(cards, eq(cards.id, readingCards.cardId))
          .where(inArray(readingCards.readingId, liveReadingIds))
      : Promise.resolve([]),
    spreadIds.length
      ? db
          .select({ id: spreads.id, positions: spreads.positions })
          .from(spreads)
          .where(inArray(spreads.id, spreadIds))
      : Promise.resolve([]),
    db
      .select({
        objectId: objectThemes.objectId,
        weight: objectThemes.weight,
        label: themes.label,
      })
      .from(objectThemes)
      .innerJoin(themes, eq(themes.id, objectThemes.themeId))
      .where(and(eq(objectThemes.userId, userId), inArray(objectThemes.objectId, objectIds))),
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
          eq(entityMentions.userId, userId),
          inArray(entityMentions.objectId, objectIds),
          inArray(entityMentions.resolution, [...CONTEXT_RESOLUTIONS]),
          eq(entities.status, 'active'),
        ),
      ),
    db
      .select({
        objectId: journeyMembers.objectId,
        journeyId: journeyMembers.journeyId,
        title: journeys.title,
      })
      .from(journeyMembers)
      .innerJoin(journeys, eq(journeys.id, journeyMembers.journeyId))
      .where(
        and(
          eq(journeyMembers.userId, userId),
          inArray(journeyMembers.objectId, objectIds),
          inArray(journeyMembers.state, ['auto', 'confirmed']),
          isNull(journeys.dismissedAt),
          isNull(journeys.mergedIntoId),
        ),
      ),
    liveReadingIds.length
      ? db
          .select({
            readingId: predictions.readingId,
            text: predictions.text,
            timeframeText: predictions.timeframeText,
          })
          .from(predictions)
          .where(
            and(
              eq(predictions.userId, userId),
              inArray(predictions.readingId, liveReadingIds),
              isNull(predictions.dismissedAt),
            ),
          )
          .orderBy(predictions.createdAt)
      : Promise.resolve([]),
    liveReadingIds.length
      ? db
          .select({
            readingId: outcomes.readingId,
            predictionId: outcomes.predictionId,
            lifeEventId: outcomes.lifeEventId,
            status: outcomes.status,
            note: outcomes.note,
            createdAt: outcomes.createdAt,
          })
          .from(outcomes)
          .where(and(eq(outcomes.userId, userId), inArray(outcomes.readingId, liveReadingIds)))
          .orderBy(outcomes.createdAt)
      : Promise.resolve([]),
    db
      .select({
        fromType: links.fromType,
        fromId: links.fromId,
        toType: links.toType,
        toId: links.toId,
        state: links.state,
      })
      .from(links)
      .where(
        and(
          eq(links.userId, userId),
          inArray(links.state, ['confirmed', 'maybe']),
          or(inArray(links.fromId, objectIds), inArray(links.toId, objectIds)),
        ),
      ),
  ]);

  // Titles of the other side of every link and of every outcome's event: one query per type.
  const otherReadingIds = new Set<string>();
  const otherEventIds = new Set<string>();
  for (const l of linkRows) {
    for (const [t, i] of [
      [l.fromType, l.fromId],
      [l.toType, l.toId],
    ] as const) {
      if (t === 'reading' && !liveReadingIds.includes(i)) otherReadingIds.add(i);
      if (t === 'life_event' && !liveEventIds.includes(i)) otherEventIds.add(i);
    }
  }
  for (const o of outcomeRows)
    if (o.lifeEventId && !liveEventIds.includes(o.lifeEventId)) otherEventIds.add(o.lifeEventId);
  const [otherReadings, otherEvents] = await Promise.all([
    otherReadingIds.size
      ? db
          .select({ id: readings.id, question: readings.question, occurredAt: readings.occurredAt })
          .from(readings)
          .where(
            and(
              eq(readings.userId, userId),
              isNull(readings.deletedAt),
              inArray(readings.id, [...otherReadingIds]),
            ),
          )
      : Promise.resolve([]),
    otherEventIds.size
      ? db
          .select({
            id: lifeEvents.id,
            description: lifeEvents.description,
            occurredOn: lifeEvents.occurredOn,
          })
          .from(lifeEvents)
          .where(
            and(
              eq(lifeEvents.userId, userId),
              isNull(lifeEvents.deletedAt),
              inArray(lifeEvents.id, [...otherEventIds]),
            ),
          )
      : Promise.resolve([]),
  ]);
  const titleOf = new Map<string, { title: string; date: string }>();
  for (const r of readingRows)
    titleOf.set(r.id, {
      title: r.question ?? 'an open reflection',
      date: dayOf(r.occurredAt.toISOString()),
    });
  for (const r of otherReadings)
    titleOf.set(r.id, {
      title: r.question ?? 'an open reflection',
      date: dayOf(r.occurredAt.toISOString()),
    });
  for (const e of eventRows) titleOf.set(e.id, { title: e.description, date: e.occurredOn });
  for (const e of otherEvents) titleOf.set(e.id, { title: e.description, date: e.occurredOn });

  const positionNames = new Map<string, Map<string, string>>();
  for (const s of spreadRows) {
    const m = new Map<string, string>();
    for (const p of (s.positions as { key?: string; name?: string }[]) ?? [])
      if (p.key && p.name) m.set(p.key, p.name);
    positionNames.set(s.id, m);
  }
  const cardsBy = new Map<string, HistoryObject['cards']>();
  for (const c of cardRows.slice().sort((a, b) => a.positionIndex - b.positionIndex)) {
    const reading = readingRows.find((r) => r.id === c.readingId);
    const position = reading
      ? (positionNames.get(reading.spreadId)?.get(c.positionKey) ?? null)
      : null;
    cardsBy.set(c.readingId, [
      ...(cardsBy.get(c.readingId) ?? []),
      { name: c.name, orientation: c.orientation as 'upright' | 'reversed', position },
    ]);
  }
  const themesBy = new Map<string, { label: string; weight: number }[]>();
  for (const t of themeRows)
    themesBy.set(t.objectId, [
      ...(themesBy.get(t.objectId) ?? []),
      { label: t.label, weight: Number(t.weight) },
    ]);
  const entitiesBy = new Map<string, { id: string; label: string }[]>();
  for (const m of mentionRows) {
    const list = entitiesBy.get(m.objectId) ?? [];
    if (!list.some((e) => e.id === m.entityId)) list.push({ id: m.entityId, label: m.label });
    entitiesBy.set(m.objectId, list);
  }
  const journeysBy = new Map<string, { id: string; title: string }[]>();
  for (const m of memberRows) {
    const list = journeysBy.get(m.objectId) ?? [];
    if (!list.some((j) => j.id === m.journeyId)) list.push({ id: m.journeyId, title: m.title });
    journeysBy.set(m.objectId, list);
  }
  const predictionsBy = new Map<string, { text: string; timeframeText: string | null }[]>();
  for (const p of predictionRows)
    predictionsBy.set(p.readingId, [...(predictionsBy.get(p.readingId) ?? []), p]);
  // Newest outcome per target (reading-level, or per possibility) is current.
  const outcomesBy = new Map<string, HistoryObject['outcomes']>();
  const currentByTarget = new Map<string, (typeof outcomeRows)[number]>();
  for (const o of outcomeRows)
    currentByTarget.set(`${o.readingId}:${o.predictionId ?? 'reading'}`, o);
  for (const o of currentByTarget.values())
    outcomesBy.set(o.readingId, [
      ...(outcomesBy.get(o.readingId) ?? []),
      {
        status: OUTCOME_SHORT[o.status as OutcomeStatus] ?? o.status,
        note: o.note,
        recordedOn: dayOf(o.createdAt.toISOString()),
        eventTitle: o.lifeEventId ? (titleOf.get(o.lifeEventId)?.title ?? null) : null,
      },
    ]);
  const linksBy = new Map<string, HistoryObject['links']>();
  for (const l of linkRows) {
    for (const [selfId, otherType, otherId] of [
      [l.fromId, l.toType, l.toId],
      [l.toId, l.fromType, l.fromId],
    ] as const) {
      if (!objectIds.includes(selfId)) continue;
      const other = titleOf.get(otherId);
      if (!other) continue;
      linksBy.set(selfId, [
        ...(linksBy.get(selfId) ?? []),
        {
          state: l.state as CiteableLinkState,
          otherType: otherType as HistoryObjectType,
          otherId,
          otherTitle: other.title,
          otherDate: other.date,
        },
      ]);
    }
  }

  for (const r of readingRows) {
    const at = r.occurredAt.toISOString();
    const preds = predictionsBy.get(r.id) ?? [];
    out.set(r.id, {
      id: r.id,
      type: 'reading',
      userId,
      occurredAt: at,
      date: dayOf(at),
      title: r.isOpenReflection ? null : r.question,
      notes: r.notes,
      lifeAreaKey: r.lifeArea,
      lifeAreaLabel: lifeAreaLabel(r.lifeArea),
      eventTypeLabel: null,
      deckName: r.deckName,
      cards: cardsBy.get(r.id) ?? [],
      themes: (themesBy.get(r.id) ?? []).sort((a, b) => b.weight - a.weight).map((t) => t.label),
      entities: (entitiesBy.get(r.id) ?? []).map((e) => e.label),
      entityIds: (entitiesBy.get(r.id) ?? []).map((e) => e.id),
      journeyTitles: (journeysBy.get(r.id) ?? []).map((j) => j.title),
      journeyIds: (journeysBy.get(r.id) ?? []).map((j) => j.id),
      possibilities: preds.map((p) => p.text),
      timeframe: preds.find((p) => p.timeframeText)?.timeframeText ?? null,
      followUp: r.followUp,
      outcomes: outcomesBy.get(r.id) ?? [],
      links: linksBy.get(r.id) ?? [],
    });
  }
  for (const e of eventRows) {
    out.set(e.id, {
      id: e.id,
      type: 'life_event',
      userId,
      occurredAt: eventInstant(e.occurredOn),
      date: e.occurredOn,
      title: e.description,
      notes: e.note,
      lifeAreaKey: e.lifeArea,
      lifeAreaLabel: lifeAreaLabel(e.lifeArea),
      eventTypeLabel: eventTypeLabel(e.eventType),
      deckName: null,
      cards: [],
      themes: (themesBy.get(e.id) ?? []).sort((a, b) => b.weight - a.weight).map((t) => t.label),
      entities: (entitiesBy.get(e.id) ?? []).map((x) => x.label),
      entityIds: (entitiesBy.get(e.id) ?? []).map((x) => x.id),
      journeyTitles: (journeysBy.get(e.id) ?? []).map((j) => j.title),
      journeyIds: (journeysBy.get(e.id) ?? []).map((j) => j.id),
      possibilities: [],
      timeframe: null,
      followUp: null,
      outcomes: [],
      links: linksBy.get(e.id) ?? [],
    });
  }
  return out;
}

/** Ids of every live reading and event of a user (backfill, tests). */
export async function listLiveObjectIds(
  userId: string,
  limit = 5000,
): Promise<{ type: HistoryObjectType; id: string }[]> {
  const db = platformDb();
  const [r, e] = await Promise.all([
    db
      .select({ id: readings.id })
      .from(readings)
      .where(and(eq(readings.userId, userId), isNull(readings.deletedAt)))
      .orderBy(sql`${readings.occurredAt} desc`)
      .limit(limit),
    db
      .select({ id: lifeEvents.id })
      .from(lifeEvents)
      .where(and(eq(lifeEvents.userId, userId), isNull(lifeEvents.deletedAt)))
      .orderBy(sql`${lifeEvents.occurredOn} desc`)
      .limit(limit),
  ]);
  return [
    ...r.map((x) => ({ type: 'reading' as const, id: x.id })),
    ...e.map((x) => ({ type: 'life_event' as const, id: x.id })),
  ];
}

/** Whether an object exists, is the user's and is live — used before building a document. */
export async function objectOwner(
  type: HistoryObjectType,
  id: string,
): Promise<{ userId: string; deleted: boolean } | null> {
  const db = platformDb();
  if (type === 'reading') {
    const [row] = await db
      .select({ userId: readings.userId, deletedAt: readings.deletedAt })
      .from(readings)
      .where(eq(readings.id, id))
      .limit(1);
    return row ? { userId: row.userId, deleted: row.deletedAt !== null } : null;
  }
  const [row] = await db
    .select({ userId: lifeEvents.userId, deletedAt: lifeEvents.deletedAt })
    .from(lifeEvents)
    .where(eq(lifeEvents.id, id))
    .limit(1);
  return row ? { userId: row.userId, deleted: row.deletedAt !== null } : null;
}
