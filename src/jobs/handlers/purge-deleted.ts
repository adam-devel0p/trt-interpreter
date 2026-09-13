import { z } from 'zod';
import { purgeReading, purgeSoftDeletedReadings } from '@/privacy/purge';
import { defineJob } from '../types';

/**
 * Hard-delete soft-deleted readings and every dependent artifact, writing a receipt each
 * (docs/PRIVACY_AND_DELETION.md#deletion-flows). With a `readingId` it purges that one
 * (enqueued by the delete action and run straight away); without one it sweeps everything
 * soft-deleted more than `olderThanMs` ago — the safety net for a purge that failed and
 * exhausted its retries. Payloads carry IDs only.
 */
export const purgeDeletedPayload = z
  .object({
    readingId: z.string().uuid().nullable().default(null),
    olderThanMs: z.number().int().min(0).default(0),
  })
  .strict();

export const purgeDeleted = defineJob({
  kind: 'purge_deleted',
  schema: purgeDeletedPayload,
  async run(payload, ctx) {
    if (payload.readingId) {
      const res = await purgeReading(payload.readingId, { jobId: ctx.jobId });
      ctx.log.info('jobs.purge_deleted.ran', { objectId: payload.readingId, count: res ? 1 : 0 });
      return;
    }
    const purged = await purgeSoftDeletedReadings(payload.olderThanMs, { jobId: ctx.jobId });
    ctx.log.info('jobs.purge_deleted.swept', { count: purged.length });
  },
});
