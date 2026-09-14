import 'server-only';
import { and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { MockEvidenceObject } from '@/ai/tasks/answer_from_evidence';
import { platformDb } from '@/db/admin';
import { journeyMembers, journeys, lifeEvents, outcomes, readings } from '@/db/schema';
import { fnv1a } from '@/domain/extraction/hash';
import { boundPackage, PACKAGE_MAX_TOKENS } from '@/domain/retrieval/bound';
import {
  labelEvidence,
  renderPackage,
  type EvidencePackage,
  type LabelledEvidence,
} from '@/domain/retrieval/evidence';
import type { LabelFacts, SourceRef } from '@/domain/summaries/provenance';
import { SUMMARY_MAX_OBJECTS } from '@/domain/summaries/thresholds';
import { toEvidenceObject } from '@/retrieval/ask';
import { loadHistoryObjects, type HistoryObject } from '@/retrieval/objects';

/**
 * Evidence for summaries and narratives: the same labelled, rendered package the Ask
 * pipeline hands the answerer (spec §11 minimum context, §13 bounded), built from a period's
 * or a journey's live objects in date order and bounded to `SUMMARY_MAX_OBJECTS` /
 * `PACKAGE_MAX_TOKENS`. What can be evidence is decided upstream in `retrieval/objects.ts`
 * (resolved entities only, citeable links only, no soft-deleted objects, one user). Each
 * label also carries `confirmed`: whether it holds a user-recorded fact (a life event, an
 * outcome, a confirmed connection) — the verifier's basis check reads it.
 */

export interface SummaryEvidence {
  package: EvidencePackage;
  rendered: string;
  labels: Map<string, LabelFacts>;
  /** Label → source ref, for mapping citations back to ids. */
  byLabel: Map<string, SourceRef>;
  sources: SourceRef[];
  mockObjects: MockEvidenceObject[];
  counts: { readings: number; events: number; outcomes: number; confirmedLinks: number };
  /** Titles of journeys any object in the package sits in. */
  journeys: string[];
  /** Objects in scope but left out by the bound. */
  droppedCount: number;
  /** Hash of the rendered package: an unchanged input is not regenerated. */
  inputHash: string;
  /** Live objects in scope before bounding (the data floor reads this). */
  objectCount: number;
}

function toMockObject(e: LabelledEvidence): MockEvidenceObject {
  return {
    label: e.label,
    type: e.type,
    date: e.date,
    title: e.title,
    noteExcerpt: e.noteExcerpt,
    lifeArea: e.lifeArea,
    cards: e.cards.map((c) => c.name),
    themes: e.themes,
    entities: e.entities,
    journeys: e.journeys,
    followUp: e.followUp,
    outcomes: e.outcomes.map((o) => ({ status: o.status, note: o.note, eventTitle: o.eventTitle })),
    links: e.links.map((l) => ({
      state: l.state,
      otherType: l.otherType,
      otherTitle: l.otherTitle,
      otherDate: l.otherDate,
    })),
  };
}

function isConfirmed(o: LabelledEvidence): boolean {
  return (
    o.type === 'life_event' || o.outcomes.length > 0 || o.links.some((l) => l.state === 'confirmed')
  );
}

export function packageEvidence(objects: readonly HistoryObject[]): SummaryEvidence {
  const ordered = [...objects].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const labelled = labelEvidence(ordered.map(toEvidenceObject));
  const bound = boundPackage(labelled, {
    maxObjects: SUMMARY_MAX_OBJECTS,
    maxTokens: PACKAGE_MAX_TOKENS,
  });
  const kept = labelEvidence(bound.kept);
  const pkg: EvidencePackage = {
    objects: kept,
    droppedIds: bound.dropped.map((d) => ({ type: d.type, id: d.id })),
    tokens: kept.reduce((s, o) => s + o.tokens, 0),
  };
  const rendered = renderPackage(pkg);
  const labels = new Map<string, LabelFacts>();
  const byLabel = new Map<string, SourceRef>();
  for (const o of kept) {
    labels.set(o.label, { confirmed: isConfirmed(o) });
    byLabel.set(o.label, { type: o.type, id: o.id });
  }
  return {
    package: pkg,
    rendered,
    labels,
    byLabel,
    sources: kept.map((o) => ({ type: o.type, id: o.id })),
    mockObjects: kept.map(toMockObject),
    counts: {
      readings: kept.filter((o) => o.type === 'reading').length,
      events: kept.filter((o) => o.type === 'life_event').length,
      outcomes: kept.reduce((n, o) => n + o.outcomes.length, 0),
      confirmedLinks: kept.reduce(
        (n, o) => n + o.links.filter((l) => l.state === 'confirmed').length,
        0,
      ),
    },
    journeys: [...new Set(kept.flatMap((o) => o.journeys))],
    droppedCount: bound.dropped.length,
    inputHash: fnv1a(rendered),
    objectCount: objects.length,
  };
}

/** Live readings and events of a user inside `[start, end]` (ISO dates, inclusive). */
export async function listPeriodObjectIds(
  userId: string,
  period: { start: string; end: string },
): Promise<{ readings: string[]; events: string[] }> {
  const db = platformDb();
  const from = new Date(`${period.start}T00:00:00Z`);
  const to = new Date(`${period.end}T23:59:59.999Z`);
  const [r, e] = await Promise.all([
    db
      .select({ id: readings.id })
      .from(readings)
      .where(
        and(
          eq(readings.userId, userId),
          isNull(readings.deletedAt),
          gte(readings.occurredAt, from),
          lte(readings.occurredAt, to),
        ),
      ),
    db
      .select({ id: lifeEvents.id })
      .from(lifeEvents)
      .where(
        and(
          eq(lifeEvents.userId, userId),
          isNull(lifeEvents.deletedAt),
          gte(lifeEvents.occurredOn, period.start),
          lte(lifeEvents.occurredOn, period.end),
        ),
      ),
  ]);
  return { readings: r.map((x) => x.id), events: e.map((x) => x.id) };
}

/** Live (non-pending, non-removed) members of a journey, by type. */
export async function listJourneyObjectIds(
  journeyId: string,
): Promise<{ readings: string[]; events: string[]; userId: string | null }> {
  const db = platformDb();
  const [j] = await db
    .select({ userId: journeys.userId })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);
  if (!j) return { readings: [], events: [], userId: null };
  const rows = await db
    .select({ type: journeyMembers.objectType, id: journeyMembers.objectId })
    .from(journeyMembers)
    .where(
      and(
        eq(journeyMembers.journeyId, journeyId),
        ne(journeyMembers.state, 'removed'),
        ne(journeyMembers.state, 'pending'),
      ),
    );
  return {
    userId: j.userId,
    readings: rows.filter((r) => r.type === 'reading').map((r) => r.id),
    events: rows.filter((r) => r.type === 'life_event').map((r) => r.id),
  };
}

export async function loadPeriodEvidence(
  userId: string,
  period: { start: string; end: string },
): Promise<SummaryEvidence> {
  const ids = await listPeriodObjectIds(userId, period);
  const objects = await loadHistoryObjects(userId, ids);
  return packageEvidence([...objects.values()]);
}

export async function loadJourneyEvidence(
  journeyId: string,
): Promise<{ userId: string; evidence: SummaryEvidence; confirmedOutcomes: number } | null> {
  const ids = await listJourneyObjectIds(journeyId);
  if (!ids.userId) return null;
  const objects = await loadHistoryObjects(ids.userId, ids);
  const live = [...objects.values()];
  const readingIds = live.filter((o) => o.type === 'reading').map((o) => o.id);
  const confirmedOutcomes = readingIds.length
    ? Number(
        (
          await platformDb()
            .select({ n: sql<number>`count(*)::int` })
            .from(outcomes)
            .where(inArray(outcomes.readingId, readingIds))
        )[0]?.n ?? 0,
      )
    : 0;
  return { userId: ids.userId, evidence: packageEvidence(live), confirmedOutcomes };
}
