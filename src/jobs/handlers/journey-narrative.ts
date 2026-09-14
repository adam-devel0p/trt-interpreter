import { generateJourneyNarrative } from '@/summaries/narrative';
import { defineJob } from '../types';
import { journeyNarrativePayload } from './payloads';

/**
 * The §6.5 narrative header. Enqueued (deduped, delayed) whenever a journey's live members
 * change; the runner decides from the fingerprint whether anything is regenerated, so a
 * burst of changes costs one call at most.
 */
export class JourneyNarrativeRetry extends Error {
  override readonly name = 'JourneyNarrativeRetry';
}

export const journeyNarrative = defineJob({
  kind: 'journey_narrative',
  schema: journeyNarrativePayload,
  async run(payload, ctx) {
    const outcome = await generateJourneyNarrative(payload.journeyId, { force: payload.force });
    ctx.log.info('jobs.journey_narrative.ran', {
      journeyId: payload.journeyId,
      status: outcome.status,
      reason: outcome.status === 'failed' ? undefined : outcome.reason,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new JourneyNarrativeRetry(outcome.errorClass);
  },
});
