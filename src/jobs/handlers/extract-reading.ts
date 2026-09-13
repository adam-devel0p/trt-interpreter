import { runExtraction } from '@/memory/extract';
import { defineJob } from '../types';
import { extractReadingPayload } from './payloads';

/**
 * Extraction after save (spec §7.2, FR-08). Enqueued by the save and edit actions, run by the
 * cron batch — never in the request path: the reading is usable before this starts and stays
 * untouched whatever happens here. A retryable failure (timeout, provider error) throws so
 * the worker backs off and retries; every other outcome is terminal and logged by class.
 */
export class ExtractionRetry extends Error {
  override readonly name = 'ExtractionRetry';
}

export const extractReading = defineJob({
  kind: 'extract_reading_metadata',
  schema: extractReadingPayload,
  async run(payload, ctx) {
    const outcome = await runExtraction(payload.readingId, { force: payload.force });
    ctx.log.info('jobs.extract_reading.ran', {
      objectType: 'reading',
      objectId: payload.readingId,
      status: outcome.status,
      errorClass: outcome.status === 'failed' ? outcome.errorClass : undefined,
    });
    if (outcome.status === 'failed' && outcome.retryable)
      throw new ExtractionRetry(outcome.errorClass);
  },
});
