import { runProposeJourney } from '@/journeys/propose';
import { defineJob } from '../types';
import { proposeJourneyPayload } from './payloads';

/**
 * Journey naming (spec §6.5). Enqueued by the discovery step after extraction, run by the
 * cron batch. Retryable failures (timeout, provider error) throw so the worker backs off;
 * everything else is terminal — the journey keeps its placeholder title, which is honest.
 */
export class ProposeJourneyRetry extends Error {
  override readonly name = 'ProposeJourneyRetry';
}

export const proposeJourney = defineJob({
  kind: 'propose_journey',
  schema: proposeJourneyPayload,
  async run(payload, ctx) {
    const outcome = await runProposeJourney(payload.journeyId);
    ctx.log.info('jobs.propose_journey.ran', {
      journeyId: payload.journeyId,
      status: outcome.status,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new ProposeJourneyRetry(outcome.errorClass);
  },
});
