import 'server-only';
import { eq } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as narrativeTask from '@/ai/tasks/journey_narrative';
import { platformDb } from '@/db/admin';
import {
  journeyNarratives,
  journeys,
  journeyThemeProgression,
  profiles,
  themes,
} from '@/db/schema';
import { decideNarrative, narrativeFingerprint } from '@/domain/journeys/narrativeChange';
import { meetsNarrativeFloor } from '@/domain/summaries/floors';
import { validateSources, verifyNarrative } from '@/domain/summaries/provenance';
import { flagForUser } from '@/flags/server';
import { logger } from '@/observability/logger';
import { loadJourneyEvidence } from './evidence';

/**
 * The §6.5 narrative header (`journey_narrative`): one sentence plus progression labels,
 * grounded in the journey's evidence package, stored with its source ids and regenerated
 * only when the journey materially changed (`decideNarrative`: member set, confirmed
 * outcomes, or 14 days) — opening the journey serves the stored row and makes no call
 * (§19). Gates: consent, the `period_summaries` flag, the data floor. An unverifiable
 * sentence is not stored; the deterministic header stays.
 */
export type NarrativeOutcome =
  | {
      status: 'skipped';
      reason: 'missing' | 'consent' | 'flag' | 'floor' | 'unchanged' | 'ungrounded';
    }
  | { status: 'generated'; reason: 'none' | 'changed' | 'aged' | 'forced'; repaired: boolean }
  | { status: 'failed'; errorClass: string; retryable: boolean };

const RETRYABLE = new Set(['timeout', 'provider_error']);

export async function generateJourneyNarrative(
  journeyId: string,
  opts: { force?: boolean; runner?: AiRunner; now?: Date } = {},
): Promise<NarrativeOutcome> {
  const db = platformDb();
  const now = opts.now ?? new Date();
  const [journey] = await db
    .select({
      id: journeys.id,
      userId: journeys.userId,
      title: journeys.title,
      merged: journeys.mergedIntoId,
    })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);
  if (!journey || journey.merged) return { status: 'skipped', reason: 'missing' };
  const [profile] = await db
    .select({ consent: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, journey.userId))
    .limit(1);
  if (!profile?.consent) return { status: 'skipped', reason: 'consent' };
  if (!(await flagForUser('period_summaries', journey.userId)))
    return { status: 'skipped', reason: 'flag' };

  const loaded = await loadJourneyEvidence(journeyId);
  if (!loaded) return { status: 'skipped', reason: 'missing' };
  const { evidence, confirmedOutcomes } = loaded;
  if (!meetsNarrativeFloor(evidence.objectCount)) return { status: 'skipped', reason: 'floor' };
  const fingerprint = narrativeFingerprint({
    memberIds: evidence.sources.map((s) => s.id),
    confirmedOutcomes,
  });
  const [stored] = await db
    .select({
      id: journeyNarratives.id,
      fingerprint: journeyNarratives.fingerprint,
      generatedAt: journeyNarratives.generatedAt,
      promptVersion: journeyNarratives.promptVersion,
    })
    .from(journeyNarratives)
    .where(eq(journeyNarratives.journeyId, journeyId))
    .limit(1);
  const decision = decideNarrative(
    stored && stored.promptVersion === narrativeTask.PROMPT_VERSION
      ? { fingerprint: stored.fingerprint, generatedAt: stored.generatedAt.toISOString() }
      : null,
    fingerprint,
    now.toISOString(),
  );
  if (!decision.regenerate && !opts.force) return { status: 'skipped', reason: 'unchanged' };
  const sources = validateSources(evidence.sources);
  if (!sources.ok) return { status: 'skipped', reason: 'floor' };

  const progression = await db
    .select({ label: themes.label, index: journeyThemeProgression.sequenceIndex })
    .from(journeyThemeProgression)
    .innerJoin(themes, eq(themes.id, journeyThemeProgression.themeId))
    .where(eq(journeyThemeProgression.journeyId, journeyId))
    .orderBy(journeyThemeProgression.sequenceIndex);

  const runner = opts.runner ?? getAiRunner();
  const request = narrativeTask.buildJourneyNarrativeRequest(
    {
      title: journey.title,
      today: now.toISOString().slice(0, 10),
      progression: progression.map((p) => p.label),
      counts: {
        readings: evidence.counts.readings,
        events: evidence.counts.events,
        confirmedOutcomes,
      },
      evidence: evidence.rendered,
      droppedCount: evidence.droppedCount,
    },
    { userId: journey.userId, journeyId, mockObjects: evidence.mockObjects },
  );
  const first = await runner.runObject(request);
  if (!first.ok) {
    logger.info('summaries.narrative_failed', {
      userId: journey.userId,
      journeyId,
      errorClass: first.errorClass,
      status: first.status,
    });
    return {
      status: 'failed',
      errorClass: first.errorClass,
      retryable: RETRYABLE.has(first.status),
    };
  }
  const labels = new Set(evidence.labels.keys());
  let verified = verifyNarrative(first.value, labels);
  let modelId = first.meta.modelId;
  let repaired = false;
  if (!verified.grounded) {
    const second = await runner.runObject({
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: JSON.stringify(first.value) },
        { role: 'user', content: narrativeTask.repairHint(verified.issues, verified.stripped) },
      ],
    });
    if (second.ok) {
      const again = verifyNarrative(second.value, labels);
      if (again.grounded) {
        verified = again;
        modelId = second.meta.modelId;
        repaired = true;
      }
    }
  }
  if (!verified.grounded) {
    logger.info('summaries.narrative_ungrounded', { userId: journey.userId, journeyId });
    return { status: 'skipped', reason: 'ungrounded' };
  }
  const cited = verified.narrative.citations
    .map((l) => evidence.byLabel.get(l))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const row = {
    userId: journey.userId,
    journeyId,
    sentence: verified.narrative.sentence,
    progression: verified.narrative.progression,
    sourceObjectIds: cited.map((s) => s.id),
    sources: cited,
    fingerprint,
    objectCount: evidence.objectCount,
    modelId,
    promptVersion: narrativeTask.PROMPT_VERSION,
    schemaVersion: narrativeTask.SCHEMA_VERSION,
    generatedAt: now,
    staleAt: null,
    updatedAt: now,
  };
  if (stored)
    await db.update(journeyNarratives).set(row).where(eq(journeyNarratives.id, stored.id));
  else await db.insert(journeyNarratives).values(row);
  logger.info('summaries.narrative_generated', {
    userId: journey.userId,
    journeyId,
    reason: opts.force && !decision.regenerate ? 'forced' : decision.reason,
    modelId,
  });
  return {
    status: 'generated',
    reason: decision.regenerate ? decision.reason : 'forced',
    repaired,
  };
}
