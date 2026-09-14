import { runExplainCorrelation } from '@/correlation/explain';
import { defineJob } from '../types';
import { explainCorrelationPayload } from './payloads';

/**
 * Explanation of an offered link (spec §8.2). Enqueued by the correlation run, gated on
 * consent and the flag inside. Retryable failures throw; everything else is terminal — the
 * deterministic reasons stay on screen, which is honest.
 */
export class ExplainCorrelationRetry extends Error {
  override readonly name = 'ExplainCorrelationRetry';
}

export const explainCorrelation = defineJob({
  kind: 'explain_correlation',
  schema: explainCorrelationPayload,
  async run(payload, ctx) {
    const outcome = await runExplainCorrelation(payload.linkId);
    ctx.log.info('jobs.explain_correlation.ran', {
      linkId: payload.linkId,
      status: outcome.status,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new ExplainCorrelationRetry(outcome.errorClass);
  },
});
