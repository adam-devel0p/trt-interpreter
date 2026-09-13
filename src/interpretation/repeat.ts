/**
 * Repeated-question check (FR-25, §10): embed the question, compare with the last 24 hours,
 * record the ask, decide the nudge. Consent-gated by the caller. Fails soft: any error means
 * "no nudge" — the draw is never blocked by this.
 */
import type { Embedder } from '@/ai/providers/openai-embeddings';
import { buildQuestionEmbedRequest } from '@/ai/tasks/detect_repeat_question';
import type { UserClient } from '@/db/client';
import { insertQuestionAsk, listRecentQuestionAsks } from '@/db/queries/interpretations';
import { listReadingSummariesByIds, type ReadingSummary } from '@/db/queries/readings';
import { decideRepeat, REPEAT_WINDOW_MS } from '@/domain/interpretation/repeat';
import { errorClassOf, logger } from '@/observability/logger';

export interface RepeatCheckResult {
  nudge: boolean;
  priorReadings: ReadingSummary[];
}

export async function checkRepeatQuestion(args: {
  client: UserClient;
  userId: string;
  question: string;
  embedder: Embedder;
  now?: Date;
}): Promise<RepeatCheckResult> {
  const now = args.now ?? new Date();
  try {
    const embedded = await args.embedder.embed(
      buildQuestionEmbedRequest(args.question, args.userId),
    );
    const vector = embedded.vectors[0];
    if (!vector) return { nudge: false, priorReadings: [] };
    const priors = await listRecentQuestionAsks(
      args.client,
      args.userId,
      new Date(now.getTime() - REPEAT_WINDOW_MS),
    );
    const verdict = decideRepeat(vector, priors, now);
    await insertQuestionAsk(args.client, {
      userId: args.userId,
      question: args.question,
      vector,
      model: embedded.meta.modelId,
      nudgeShown: verdict.nudge,
    });
    logger.info('ai.repeat.checked', {
      userId: args.userId,
      count: verdict.similarCount,
      status: verdict.nudge ? 'nudge' : (verdict.reason ?? 'none'),
    });
    if (!verdict.nudge) return { nudge: false, priorReadings: [] };
    const priorReadings = await listReadingSummariesByIds(
      args.client,
      verdict.priorReadingIds.slice(0, 3),
    );
    return { nudge: true, priorReadings };
  } catch (err) {
    logger.warn('ai.repeat.failed', { userId: args.userId, errorClass: errorClassOf(err) });
    return { nudge: false, priorReadings: [] };
  }
}
