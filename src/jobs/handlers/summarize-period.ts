import { generatePeriodSummary } from '@/summaries/generate';
import { defineJob } from '../types';
import { summarizePeriodPayload } from './payloads';

/**
 * One period summary (FR-20). Enqueued by the sweep, the explicit regenerate action and the
 * seed. Retryable failures throw so the worker backs off; every other outcome — below the
 * floor, unchanged, ungrounded — is terminal and honest: nothing shown is the designed state.
 */
export class SummarizePeriodRetry extends Error {
  override readonly name = 'SummarizePeriodRetry';
}

export const summarizePeriod = defineJob({
  kind: 'summarize_period',
  schema: summarizePeriodPayload,
  async run(payload, ctx) {
    const outcome = await generatePeriodSummary({
      userId: payload.userId,
      kind: payload.kind,
      ...(payload.periodStart && payload.periodEnd
        ? { period: { start: payload.periodStart, end: payload.periodEnd } }
        : {}),
      ...(payload.journeyId ? { journeyId: payload.journeyId } : {}),
      force: payload.force,
      includeDismissed: payload.force,
    });
    ctx.log.info('jobs.summarize_period.ran', {
      userId: payload.userId,
      kind: payload.kind,
      status: outcome.status,
      reason: outcome.status === 'skipped' ? outcome.reason : undefined,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new SummarizePeriodRetry(outcome.errorClass);
  },
});
