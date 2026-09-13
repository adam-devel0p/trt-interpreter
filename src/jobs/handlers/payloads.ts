import { z } from 'zod';

/**
 * Payload schemas of the handlers that are loaded lazily (they reach `src/ai/`). Kept in a
 * dependency-free module so `enqueue()` can validate a payload without importing the model
 * layer — the reading and journal routes enqueue these and must stay AI-free on the import
 * graph (`opening-reading-makes-no-ai-call`). Payloads carry ids and versions only.
 */
export const extractReadingPayload = z
  .object({
    readingId: z.string().uuid(),
    /** Re-run even when a fresh extraction exists (reprocessing, manual retry). */
    force: z.boolean().default(false),
  })
  .strict();
export type ExtractReadingPayload = z.infer<typeof extractReadingPayload>;

export const reprocessExtractionsPayload = z
  .object({
    objectType: z.literal('reading').default('reading'),
    /** Target schema version; readings whose current extraction differs are re-run. */
    toSchema: z.string().min(1),
    /** Limit to one user (an account-level reprocess), or every consenting user. */
    userId: z.string().uuid().nullable().default(null),
    /** Bounded batch; the job re-enqueues itself while work remains. */
    limit: z.number().int().min(1).max(500).default(50),
  })
  .strict();
export type ReprocessExtractionsPayload = z.infer<typeof reprocessExtractionsPayload>;

/** Phase 07: name a journey the discovery step created. Ids only. */
export const proposeJourneyPayload = z
  .object({
    journeyId: z.string().uuid(),
  })
  .strict();
export type ProposeJourneyPayload = z.infer<typeof proposeJourneyPayload>;
