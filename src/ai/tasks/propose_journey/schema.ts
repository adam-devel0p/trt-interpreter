import { z } from 'zod';

/**
 * `propose_journey` output (docs/AI_LAYER.md#task-catalogue): a title, a one-sentence
 * rationale naming the entries it rests on, and a confidence *band* — never a number that
 * could read as certainty (§10). Strict: unknown keys fail validation.
 */
export const JOURNEY_PROPOSAL_SCHEMA_VERSION = 'journey_proposal/1.0.0';

export const journeyProposalSchema = z
  .object({
    /** Two to six plain words; the subject, not a verdict. */
    title: z.string().trim().min(2).max(80),
    rationale: z.string().trim().min(1).max(240),
    confidence: z.enum(['low', 'medium', 'high']),
  })
  .strict();
export type JourneyProposal = z.infer<typeof journeyProposalSchema>;
