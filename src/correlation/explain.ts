import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as explainTask from '@/ai/tasks/explain_correlation';
import { platformDb } from '@/db/admin';
import { lifeEvents, links, profiles, readings } from '@/db/schema';
import { bandFor } from '@/domain/correlation/score';
import { flagForUser } from '@/flags/server';
import { logger } from '@/observability/logger';

/**
 * `explain_correlation` (spec §8.2, §3.3): put a computed score's reasons into a sentence.
 * Reached only through the lazy job registry. Gates: consent and the `correlation_suggestions`
 * flag; the link must still be undecided or kept (a rejection needs no prose). The write
 * touches the `explanation` column and its provenance — nothing else: the model can neither
 * invent nor upgrade a link (asserted structurally by the invariant test). An explanation
 * that fails the register check is dropped; the deterministic reasons stay on screen.
 */

export type ExplainOutcome =
  | { status: 'skipped'; reason: 'missing' | 'decided' | 'hidden' | 'consent' | 'flag' | 'objects' }
  | { status: 'explained'; explanation: string }
  | { status: 'rejected'; issues: string[] }
  | { status: 'failed'; errorClass: string; retryable: boolean };

const RETRYABLE = new Set(['timeout', 'provider_error']);

export async function runExplainCorrelation(
  linkId: string,
  opts: { runner?: AiRunner } = {},
): Promise<ExplainOutcome> {
  const db = platformDb();
  const [link] = await db.select().from(links).where(eq(links.id, linkId)).limit(1);
  if (!link) return { status: 'skipped', reason: 'missing' };
  if (link.state === 'rejected') return { status: 'skipped', reason: 'decided' };
  const band =
    link.state === 'pending'
      ? bandFor(Number(link.score), link.signals as Parameters<typeof bandFor>[1])
      : 'likely';
  if (band === 'hidden') return { status: 'skipped', reason: 'hidden' };
  const [profile] = await db
    .select({ aiConsentAt: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, link.userId))
    .limit(1);
  if (!profile?.aiConsentAt) return { status: 'skipped', reason: 'consent' };
  if (!(await flagForUser('correlation_suggestions', link.userId)))
    return { status: 'skipped', reason: 'flag' };
  if (link.linkType !== 'reading_event') return { status: 'skipped', reason: 'objects' };

  const [[reading], [event]] = await Promise.all([
    db
      .select({
        question: readings.question,
        isOpenReflection: readings.isOpenReflection,
        occurredAt: readings.occurredAt,
        deletedAt: readings.deletedAt,
      })
      .from(readings)
      .where(inArray(readings.id, [link.fromId]))
      .limit(1),
    db
      .select({
        description: lifeEvents.description,
        occurredOn: lifeEvents.occurredOn,
        deletedAt: lifeEvents.deletedAt,
      })
      .from(lifeEvents)
      .where(inArray(lifeEvents.id, [link.toId]))
      .limit(1),
  ]);
  if (!reading || !event || reading.deletedAt || event.deletedAt)
    return { status: 'skipped', reason: 'objects' };

  const runner = opts.runner ?? getAiRunner();
  const res = await runner.runObject(
    explainTask.buildExplainCorrelationRequest(
      {
        reading: {
          occurred_on: reading.occurredAt.toISOString().slice(0, 10),
          question: reading.isOpenReflection ? null : reading.question,
        },
        event: { occurred_on: event.occurredOn, description: event.description },
        band: band === 'likely' ? 'likely' : 'possible',
        reasons: link.reasons,
      },
      { userId: link.userId, linkId },
    ),
  );
  if (!res.ok) {
    logger.info('correlation.explain_failed', {
      userId: link.userId,
      linkId,
      errorClass: res.errorClass,
      status: res.status,
    });
    return { status: 'failed', errorClass: res.errorClass, retryable: RETRYABLE.has(res.status) };
  }
  const issues = explainTask.explanationIssues(res.value.explanation);
  if (issues.length) {
    logger.info('correlation.explain_rejected', {
      userId: link.userId,
      linkId,
      count: issues.length,
    });
    return { status: 'rejected', issues };
  }
  // The one write: prose and provenance. Never state, score, signals or reasons.
  await db
    .update(links)
    .set({
      explanation: res.value.explanation,
      explainedModelId: res.meta.modelId,
      explainedPromptVersion: explainTask.PROMPT_VERSION,
      explainedSchemaVersion: explainTask.SCHEMA_VERSION,
      explainedAt: new Date(),
    })
    .where(eq(links.id, linkId));
  logger.info('correlation.explained', { userId: link.userId, linkId, modelId: res.meta.modelId });
  return { status: 'explained', explanation: res.value.explanation };
}
