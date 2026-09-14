import { z } from 'zod';
import { CITATION_LABEL } from '../retrieval/answer';
import { SUMMARY_MAX_CLAIMS_PER_SECTION } from './thresholds';

/**
 * `summarize_period` output (docs/AI_LAYER.md#task-catalogue, FR-20). A headline and four
 * short sections — what recurred, what shifted, what remains open, what the user confirmed
 * — each item a claim that names the evidence labels it rests on and says what kind of
 * thing it is (spec §9.2): a confirmed fact (the user's own event, outcome or confirmed
 * connection), a tarot interpretation (what the cards suggested), the user's own reflection,
 * or an inferred pattern the app noticed. The verifier (`provenance.ts`) strips unknown
 * labels, drops claims left without evidence, and refuses a "confirmed fact" that cites no
 * confirmed evidence — generated text never makes a fact (§21.7).
 */

export const PERIOD_SUMMARY_SCHEMA_VERSION = 'period_summary/1.0.0';
export const JOURNEY_NARRATIVE_SCHEMA_VERSION = 'journey_narrative/1.0.0';

export const CLAIM_BASES = [
  'confirmed_fact',
  'tarot_interpretation',
  'user_reflection',
  'inferred',
] as const;
export type ClaimBasis = (typeof CLAIM_BASES)[number];

export const CLAIM_BASIS_LABEL: Record<ClaimBasis, string> = {
  confirmed_fact: 'Confirmed by you',
  tarot_interpretation: 'From the cards',
  user_reflection: 'Your reflection',
  inferred: 'Noticed by the app',
};

export const summaryClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(320),
    basis: z.enum(CLAIM_BASES),
    citations: z.array(z.string().regex(CITATION_LABEL)).max(8),
  })
  .strict();
export type SummaryClaim = z.infer<typeof summaryClaimSchema>;

export const SUMMARY_SECTIONS = ['recurred', 'shifted', 'open', 'confirmed'] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];

export const SUMMARY_SECTION_TITLE: Record<SummarySection, string> = {
  recurred: 'What kept coming back',
  shifted: 'What shifted',
  open: 'What is still open',
  confirmed: 'What you confirmed happened',
};

const section = () => z.array(summaryClaimSchema).max(SUMMARY_MAX_CLAIMS_PER_SECTION);

export const periodSummarySchema = z
  .object({
    /** One plain sentence, the whole period at a glance. */
    headline: z.string().trim().min(1).max(200),
    recurred: section(),
    shifted: section(),
    open: section(),
    confirmed: section(),
  })
  .strict();
export type PeriodSummary = z.infer<typeof periodSummarySchema>;

/** A claim as stored: citations mapped from labels to object refs (`period_summaries.highlights`). */
export interface StoredClaim {
  text: string;
  basis: ClaimBasis;
  citations: { type: string; id: string }[];
}
export type StoredHighlights = Record<SummarySection, StoredClaim[]>;

/**
 * `journey_narrative` output (spec §6.5): one sentence and the progression labels it rests
 * on. The sentence must cite; a narrative without evidence is not stored.
 */
export const journeyNarrativeSchema = z
  .object({
    sentence: z.string().trim().min(1).max(240),
    /** Two to four short labels in order, e.g. ["hesitation", "decision", "action"]. */
    progression: z.array(z.string().trim().min(1).max(40)).max(4),
    citations: z.array(z.string().regex(CITATION_LABEL)).min(1).max(12),
  })
  .strict();
export type JourneyNarrative = z.infer<typeof journeyNarrativeSchema>;
