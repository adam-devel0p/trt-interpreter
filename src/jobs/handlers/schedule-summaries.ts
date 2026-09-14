import { scheduleSummaries } from '@/summaries/schedule';
import { defineJob } from '../types';
import { scheduleSummariesPayload } from './payloads';

/**
 * The sweep (FR-20 "after enough data exists"): for one or every consenting user on the
 * flag, queue a `summarize_period` for each recent complete week and month that is above
 * the floor and has no summary yet, and a `journey_narrative` (+ journey summary) for each
 * open journey. Model-free itself; a cron entry calls it (`pnpm jobs:run` enqueues one
 * when asked).
 */
export const scheduleSummariesJob = defineJob({
  kind: 'schedule_summaries',
  schema: scheduleSummariesPayload,
  async run(payload, ctx) {
    const out = await scheduleSummaries(payload);
    ctx.log.info('jobs.schedule_summaries.ran', {
      count: out.enqueued,
      attempts: out.usersSeen,
    });
  },
});
