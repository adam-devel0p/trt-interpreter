import { correlateObject } from '@/correlation/run';
import { defineJob } from '../types';
import { correlateObjectPayload } from './payloads';

/**
 * Correlation after extraction (spec §8.2), both directions: a new event against past
 * readings, a newly extracted reading against past events. Model-free; the explanations it
 * queues are the model task. Idempotent — a re-run refreshes pending rows and never
 * re-decides what the user decided.
 */
export const correlateObjectJob = defineJob({
  kind: 'correlate_object',
  schema: correlateObjectPayload,
  async run(payload, ctx) {
    const out = await correlateObject(payload.objectType, payload.objectId);
    ctx.log.info('jobs.correlate_object.ran', {
      objectType: payload.objectType,
      objectId: payload.objectId,
      count: out.stored,
      offered: out.offered,
      status: out.skipped ?? 'ran',
    });
  },
});
