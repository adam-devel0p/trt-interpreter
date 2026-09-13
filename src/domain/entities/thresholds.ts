/**
 * Entity-resolution constants (docs/ALGORITHMS.md#1-entity-resolution-71-fr-09). Change values
 * here, never inline; every boundary is covered by a fixture test in `resolve.test.ts`.
 */

/** top ≥ AUTO_LINK and (top − second) ≥ AUTO_MARGIN → resolution 'auto'. */
export const AUTO_LINK = 0.85;
export const AUTO_MARGIN = 0.15;
/** TENTATIVE ≤ top < AUTO_LINK → 'tentative' (never a confirmed fact in generated text). */
export const TENTATIVE = 0.6;
/** top ≥ TENTATIVE and (top − second) < AMBIGUOUS_MARGIN → ambiguous; ask only if history changes. */
export const AMBIGUOUS_MARGIN = 0.08;

/** Candidate generation floors. */
export const TRIGRAM_MIN = 0.45;
export const EMBEDDING_MIN = 0.75;

/** Signal weights; sum to 1. Unavailable signals are renormalised out (see resolve.ts). */
export const WEIGHTS = {
  alias_exactness: 0.35,
  role_consistency: 0.2,
  journey_overlap: 0.15,
  recency_cooccurrence: 0.15,
  kind_agreement: 0.15,
} as const;

/** Alias channel values. */
export const ALIAS_EXACT = 1.0;
/** A proper name arriving for an entity known only by a descriptor with the same role. */
export const ALIAS_NAMES_DESCRIPTOR = 0.85;
export const ALIAS_TRIGRAM = 0.7;
/**
 * A descriptor whose role succeeds the candidate's active role ("my ex" for the partner).
 * Weaker than a name resemblance; when both agree the pair counts as ALIAS_NAMES_DESCRIPTOR.
 */
export const ALIAS_ROLE_SUCCESSOR = 0.6;
export const ALIAS_EMBEDDING = 0.4;

/** recency = exp(−days_since_last_seen / RECENCY_HALF_DAYS). */
export const RECENCY_HALF_DAYS = 120;

/** At most one disambiguation question per save (§4.1). */
export const MAX_ASKS_PER_OBJECT = 1;
