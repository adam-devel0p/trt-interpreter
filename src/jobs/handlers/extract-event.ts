import { enqueueCorrelationSafely } from '@/correlation/run';
import { runEventExtraction } from '@/events/extract';
import { platformDb } from '@/db/admin';
import { lifeEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { defineJob } from '../types';
import { extractEventPayload } from './payloads';

/**
 * Event extraction after save (spec §6.4). Enqueued by the save action, run by the cron
 * batch — never in the request path: the event is usable before this starts and stays
 * untouched whatever happens here. A retryable failure throws so the worker backs off; every
 * other outcome is terminal, and the correlation run is queued regardless so the event's
 * screen can say honestly whether anything was found (with no extraction the answer is
 * simply "nothing", never a spinner that never ends).
 */
export class EventExtractionRetry extends Error {
  override readonly name = 'EventExtractionRetry';
}

export const extractEvent = defineJob({
  kind: 'extract_event_metadata',
  schema: extractEventPayload,
  async run(payload, ctx) {
    const outcome = await runEventExtraction(payload.eventId, { force: payload.force });
    ctx.log.info('jobs.extract_event.ran', {
      objectType: 'life_event',
      objectId: payload.eventId,
      status: outcome.status,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new EventExtractionRetry(outcome.errorClass);
    // Materialisation already queued a correlation run when the extraction completed; a
    // skipped or terminally failed run still gets one so `correlated_at` is set.
    if (outcome.status !== 'complete') {
      const [row] = await platformDb()
        .select({ userId: lifeEvents.userId })
        .from(lifeEvents)
        .where(eq(lifeEvents.id, payload.eventId))
        .limit(1);
      if (row) await enqueueCorrelationSafely('life_event', payload.eventId, row.userId);
    }
  },
});
