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

/** Phase 08: extract a life event's metadata. Ids only. */
export const extractEventPayload = z
  .object({
    eventId: z.string().uuid(),
    force: z.boolean().default(false),
  })
  .strict();
export type ExtractEventPayload = z.infer<typeof extractEventPayload>;

/** Phase 08: score one object against the other kind (model-free). */
export const correlateObjectPayload = z
  .object({
    objectType: z.enum(['reading', 'life_event']),
    objectId: z.string().uuid(),
  })
  .strict();
export type CorrelateObjectPayload = z.infer<typeof correlateObjectPayload>;

/** Phase 08: put a computed link's reasons into a sentence. */
export const explainCorrelationPayload = z
  .object({
    linkId: z.string().uuid(),
  })
  .strict();
export type ExplainCorrelationPayload = z.infer<typeof explainCorrelationPayload>;

/** Phase 09: rebuild one object's retrieval document and embed it. Ids only. */
export const embedObjectPayload = z
  .object({
    objectType: z.enum(['reading', 'life_event']),
    objectId: z.string().uuid(),
  })
  .strict();
export type EmbedObjectPayload = z.infer<typeof embedObjectPayload>;

/** Phase 09: build missing documents and re-embed stale vectors, bounded; re-enqueues itself. */
export const backfillEmbeddingsPayload = z
  .object({
    userId: z.string().uuid().nullable().default(null),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();
export type BackfillEmbeddingsPayload = z.infer<typeof backfillEmbeddingsPayload>;

/** Phase 10: generate (or regenerate) one period summary. Ids, a kind and dates only. */
export const summarizePeriodPayload = z
  .object({
    userId: z.string().uuid(),
    kind: z.enum(['weekly', 'monthly', 'journey', 'yearly']),
    periodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    periodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    journeyId: z.string().uuid().nullable().default(null),
    force: z.boolean().default(false),
  })
  .strict();
export type SummarizePeriodPayload = z.infer<typeof summarizePeriodPayload>;

/** Phase 10: regenerate a journey's narrative header when it materially changed. */
export const journeyNarrativePayload = z
  .object({
    journeyId: z.string().uuid(),
    force: z.boolean().default(false),
  })
  .strict();
export type JourneyNarrativePayload = z.infer<typeof journeyNarrativePayload>;

/** Phase 10: the sweep — recent complete periods and journeys of one or every consenting user. */
export const scheduleSummariesPayload = z
  .object({
    userId: z.string().uuid().nullable().default(null),
    /** How many recent complete months and weeks to consider. */
    months: z.number().int().min(1).max(12).default(2),
    weeks: z.number().int().min(0).max(8).default(2),
  })
  .strict();
export type ScheduleSummariesPayload = z.infer<typeof scheduleSummariesPayload>;
