import { z } from 'zod';

/**
 * `explain_correlation` output (docs/AI_LAYER.md#task-catalogue): one or two plain sentences
 * that put the reasons the code already computed into words. No score, no number, no
 * verdict — the schema is a single bounded string and the validator (`index.ts`) rejects
 * certainty and figures.
 */
export const CORRELATION_EXPLANATION_SCHEMA_VERSION = 'correlation_explanation/1.0.0';

export const correlationExplanationSchema = z
  .object({
    explanation: z.string().trim().min(20).max(280),
  })
  .strict();
export type CorrelationExplanation = z.infer<typeof correlationExplanationSchema>;
