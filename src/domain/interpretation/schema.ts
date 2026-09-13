/**
 * The layered interpretation (spec §9.3, §6.2 step 8). The schema *is* the layering: one
 * sentence, then per card in position, then the combined reading, then reflective prompts.
 * Shared by the AI task (what the model must produce), the query layer (what is stored) and the
 * UI (what is rendered), so it lives in domain/ and imports nothing.
 */
import { z } from 'zod';

export const SYNTHESIS_MAX = 320;
export const NUANCES_MAX = 3;
export const PROMPTS_MIN = 2;
export const PROMPTS_MAX = 3;

/** What the model writes. `card_id` is attached by the caller from the reading, never by the model. */
export const modelPerCardSchema = z
  .object({
    position_index: z.number().int().min(0),
    text: z.string().min(40).max(1600),
    nuances: z.array(z.string().min(8).max(300)).max(NUANCES_MAX),
  })
  .strict();

export const modelInterpretationSchema = z
  .object({
    synthesis: z.string().min(20).max(SYNTHESIS_MAX),
    per_card: z.array(modelPerCardSchema).min(1).max(12),
    combined: z.string().min(40).max(3000),
    reflective_prompts: z.array(z.string().min(10).max(240)).min(PROMPTS_MIN).max(PROMPTS_MAX),
  })
  .strict();
export type ModelInterpretation = z.infer<typeof modelInterpretationSchema>;

export const perCardSchema = modelPerCardSchema.extend({ card_id: z.string().uuid() }).strict();
export type PerCard = z.infer<typeof perCardSchema>;

/** The stored artifact: the model's output with card ids resolved from the reading. */
export const interpretationOutputSchema = modelInterpretationSchema
  .extend({ per_card: z.array(perCardSchema).min(1).max(12) })
  .strict();
export type InterpretationOutput = z.infer<typeof interpretationOutputSchema>;

/**
 * A partial view while streaming: every field optional, strings possibly cut mid-sentence.
 * Produced by `partialInterpretation()` from the accumulating JSON text.
 */
export interface PartialInterpretation {
  synthesis?: string;
  per_card?: { position_index?: number; text?: string; nuances?: string[] }[];
  combined?: string;
  reflective_prompts?: string[];
}

export const INTERPRETATION_STATUSES = ['pending', 'streaming', 'complete', 'failed'] as const;
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number];

/** Why an interpretation ended without output. Persisted to `interpretations.error_class`. */
export const INTERPRETATION_ERROR_CLASSES = [
  'invalid_output',
  'timeout',
  'provider_error',
  'budget_denied',
  'refusal',
  'circuit_open',
  'deck_purity',
  'cancelled',
  'consent',
] as const;
export type InterpretationErrorClass = (typeof INTERPRETATION_ERROR_CLASSES)[number];
