import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { lifeEvents, links, profiles, readings } from '@/db/schema';
import { shouldResurface } from '@/domain/correlation/resurface';
import {
  scorePair,
  selectSuggestions,
  type Correlation,
  type CorrelationObject,
  type Scored,
} from '@/domain/correlation/score';
import {
  CANDIDATE_WINDOW_DAYS,
  MAX_CANDIDATES,
  MAX_SUGGESTIONS,
} from '@/domain/correlation/thresholds';
import { flagForUser } from '@/flags/server';
import { enqueue } from '@/jobs/enqueue';
import { errorClassOf, logger } from '@/observability/logger';
import { loadCandidateIds, loadCorrelationFeatures } from './features';

/**
 * The correlation run (docs/ALGORITHMS.md §3, spec §8.2): one new object — a life event or a
 * reading — against the other kind within the candidate window. Model-free. Every pair is
 * scored by the pure engine; eligible pairs at or above the store floor become `links`
 * rows (`pending`, with `signals`, `reasons`, `evidence` and a fingerprint); the strongest
 * visible ones, at most three per object in total, are marked `offered_at` and get an
 * `explain_correlation` job. Rows the user already decided are never re-decided: a
 * confirmed or maybe link keeps its state (its evidence is refreshed), a rejected one comes
 * back only under the §19 rule (`shouldResurface`). Zero candidates is a normal result; the
 * event's `correlated_at` says the check ran so the screen can say so plainly.
 *
 * Canonical direction of a `reading_event` link: from the reading to the event.
 */

export type CorrelateObjectType = 'reading' | 'life_event';

export interface CorrelateResult {
  objectType: CorrelateObjectType;
  objectId: string;
  skipped?: 'missing' | 'flag';
  candidates: number;
  stored: number;
  offered: number;
  resurfaced: number;
}

export async function correlateObject(
  objectType: CorrelateObjectType,
  objectId: string,
  opts: { now?: Date } = {},
): Promise<CorrelateResult> {
  const db = platformDb();
  const now = opts.now ?? new Date();
  const result: CorrelateResult = {
    objectType,
    objectId,
    candidates: 0,
    stored: 0,
    offered: 0,
    resurfaced: 0,
  };
  const object = await loadObject(objectType, objectId);
  if (!object) return { ...result, skipped: 'missing' };
  const markDone = async () => {
    if (objectType === 'life_event')
      await db.update(lifeEvents).set({ correlatedAt: now }).where(eq(lifeEvents.id, objectId));
  };
  if (!(await flagForUser('correlation_suggestions', object.userId))) {
    await markDone();
    return { ...result, skipped: 'flag' };
  }

  const candidateIds = await loadCandidateIds(
    object.userId,
    { type: objectType, at: object.at },
    CANDIDATE_WINDOW_DAYS,
    MAX_CANDIDATES,
  );
  result.candidates = candidateIds.length;
  if (candidateIds.length === 0) {
    await markDone();
    logger.info('correlation.ran', { userId: object.userId, objectType, objectId, count: 0 });
    return result;
  }
  const set = await loadCorrelationFeatures(object.userId, {
    readings: objectType === 'reading' ? [objectId, ...candidateIds] : candidateIds,
    events: objectType === 'life_event' ? [objectId, ...candidateIds] : candidateIds,
  });
  const me = set.objects.get(objectId);
  if (!me) {
    await markDone();
    return result;
  }
  const scored: Scored<CorrelationObject>[] = [];
  for (const id of candidateIds) {
    const other = set.objects.get(id);
    if (!other) continue;
    scored.push({
      candidate: other,
      correlation: scorePair(me, other, {
        entityLabels: set.entityLabels,
        themeLabels: set.themeLabels,
        journeyTitles: set.journeyTitles,
        cardLabels: set.cardLabels,
      }),
    });
  }
  const { store, offer } = selectSuggestions(scored);
  const offerIds = new Set(offer.map((s) => s.candidate.id));

  // Guard 4 across runs: what was already offered for this object counts against the cap.
  const alreadyOffered = await db
    .select({ id: links.id })
    .from(links)
    .where(
      and(
        eq(links.userId, object.userId),
        objectType === 'reading' ? eq(links.fromId, objectId) : eq(links.toId, objectId),
        eq(links.state, 'pending'),
        isNotNull(links.offeredAt),
      ),
    );
  let slots = Math.max(0, MAX_SUGGESTIONS - alreadyOffered.length);
  const newlyOffered: string[] = [];

  for (const s of store) {
    const other = s.candidate;
    const reading = objectType === 'reading' ? me : other;
    const event = objectType === 'life_event' ? me : other;
    const [existing] = await db
      .select()
      .from(links)
      .where(
        and(
          eq(links.userId, object.userId),
          eq(links.fromType, 'reading'),
          eq(links.fromId, reading.id),
          eq(links.toType, 'life_event'),
          eq(links.toId, event.id),
          eq(links.linkType, 'reading_event'),
        ),
      )
      .limit(1);
    const c = s.correlation;
    const wantOffer = offerIds.has(other.id);
    if (!existing) {
      const offerNow = wantOffer && slots > 0;
      const [row] = await db
        .insert(links)
        .values({
          userId: object.userId,
          fromType: 'reading',
          fromId: reading.id,
          toType: 'life_event',
          toId: event.id,
          linkType: 'reading_event',
          ...evidenceColumns(c),
          createdBy: 'rule',
          state: 'pending',
          offeredAt: offerNow ? now : null,
        })
        .onConflictDoNothing()
        .returning({ id: links.id });
      result.stored += 1;
      if (row && offerNow) {
        slots -= 1;
        newlyOffered.push(row.id);
      }
      continue;
    }
    if (existing.state === 'pending') {
      const offerNow = wantOffer && !existing.offeredAt && slots > 0;
      await db
        .update(links)
        .set({ ...evidenceColumns(c), ...(offerNow ? { offeredAt: now } : {}) })
        .where(eq(links.id, existing.id));
      result.stored += 1;
      if (offerNow) {
        slots -= 1;
        newlyOffered.push(existing.id);
      }
      continue;
    }
    if (existing.state === 'confirmed' || existing.state === 'maybe') {
      // The user decided; only the evidence behind "why?" is kept current. Score stays.
      await db
        .update(links)
        .set({ signals: c.signals, reasons: c.reasons, evidence: c.evidence })
        .where(eq(links.id, existing.id));
      continue;
    }
    // Rejected: §19.
    const prevEvidence = (existing.evidence ?? {}) as {
      confirmedEntityIds?: string[];
      confirmedJourneyIds?: string[];
    };
    const verdict = shouldResurface(
      {
        state: 'rejected',
        rejectedScore: existing.rejectedScore === null ? null : Number(existing.rejectedScore),
        rejectedFingerprint: existing.rejectedFingerprint,
        confirmedEntityIds: prevEvidence.confirmedEntityIds ?? [],
        confirmedJourneyIds: prevEvidence.confirmedJourneyIds ?? [],
      },
      c,
    );
    if (!verdict.resurface || !wantOffer || slots <= 0) continue;
    await db
      .update(links)
      .set({
        ...evidenceColumns(c),
        state: 'pending',
        userActedAt: null,
        offeredAt: now,
      })
      .where(eq(links.id, existing.id));
    slots -= 1;
    result.resurfaced += 1;
    newlyOffered.push(existing.id);
    logger.info('correlation.resurfaced', {
      userId: object.userId,
      linkId: existing.id,
      reason: verdict.reason,
    });
  }
  result.offered = newlyOffered.length;

  // Explanations are a consent-gated model task; the deterministic reasons are shown until
  // (and if never) one arrives.
  if (newlyOffered.length) {
    const [profile] = await db
      .select({ aiConsentAt: profiles.aiConsentAt })
      .from(profiles)
      .where(eq(profiles.id, object.userId))
      .limit(1);
    if (profile?.aiConsentAt) {
      for (const linkId of newlyOffered) {
        try {
          await enqueue('explain_correlation', { linkId }, { userId: object.userId, dedupe: true });
        } catch (err) {
          logger.warn('correlation.explain_enqueue_failed', {
            userId: object.userId,
            linkId,
            errorClass: errorClassOf(err),
          });
        }
      }
    }
  }
  await markDone();
  logger.info('correlation.ran', {
    userId: object.userId,
    objectType,
    objectId,
    count: result.stored,
    offered: result.offered,
  });
  return result;
}

function evidenceColumns(c: Correlation) {
  return {
    score: c.score.toFixed(3),
    signals: c.signals,
    reasons: c.reasons,
    evidence: c.evidence,
    evidenceFingerprint: c.fingerprint,
  };
}

async function loadObject(
  objectType: CorrelateObjectType,
  objectId: string,
): Promise<{ userId: string; at: Date } | null> {
  const db = platformDb();
  if (objectType === 'reading') {
    const [r] = await db
      .select({
        userId: readings.userId,
        occurredAt: readings.occurredAt,
        deletedAt: readings.deletedAt,
      })
      .from(readings)
      .where(eq(readings.id, objectId))
      .limit(1);
    return r && !r.deletedAt ? { userId: r.userId, at: r.occurredAt } : null;
  }
  const [e] = await db
    .select({
      userId: lifeEvents.userId,
      occurredOn: lifeEvents.occurredOn,
      deletedAt: lifeEvents.deletedAt,
    })
    .from(lifeEvents)
    .where(eq(lifeEvents.id, objectId))
    .limit(1);
  return e && !e.deletedAt ? { userId: e.userId, at: new Date(`${e.occurredOn}T12:00:00Z`) } : null;
}

/** Fire-and-forget enqueue for the materialiser: never throws. */
export async function enqueueCorrelationSafely(
  objectType: CorrelateObjectType,
  objectId: string,
  userId: string,
): Promise<void> {
  try {
    await enqueue('correlate_object', { objectType, objectId }, { userId, dedupe: true });
  } catch (err) {
    logger.warn('correlation.enqueue_failed', {
      userId,
      objectType,
      objectId,
      errorClass: errorClassOf(err),
    });
  }
}
