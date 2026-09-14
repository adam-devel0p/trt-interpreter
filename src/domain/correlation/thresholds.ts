/**
 * Correlation thresholds (docs/ALGORITHMS.md §3, spec §8.2, FR-12, FR-13). Every number the
 * engine's decisions depend on lives here, named, so tuning is a data change and the
 * boundary tests in `__tests__/score.test.ts` pin each one. Precision over recall: a wrong
 * confident connection damages trust more than a missing one (§4.4).
 */

/**
 * Signal weights, exactly as ALGORITHMS §3 writes them (they sum to 1.05 there; the score
 * is always normalised over the signals that have data, so only the ratios matter).
 */
export const WEIGHTS = {
  journey_overlap: 0.3,
  entity_overlap: 0.25,
  semantic_similarity: 0.2,
  theme_overlap: 0.1,
  timeframe_fit: 0.1,
  temporal_proximity: 0.05,
  card_symbol_overlap: 0.05,
} as const;

/** Below this a link is invisible; it is stored only when ≥ STORE_MIN, for re-scoring. */
export const POSSIBLE = 0.55;
/** At or above this a link shows as "Likely" — still inferred, still one-tap rejectable. */
export const LIKELY = 0.75;
/**
 * "Likely" also needs a temporal signal at or above this: inside the stated window (1), or
 * proximity exp(−days/45) ≥ 0.5 — about a month. Below it a high score reads as "Possible".
 */
export const LIKELY_TEMPORAL_MIN = 0.5;
/** Rows below POSSIBLE but at or above this are stored (never shown) for future re-scoring. */
export const STORE_MIN = 0.4;

/** Guard 1: a suggestion needs at least this many non-card signals each above the floor. */
export const NON_CARD_SIGNALS_REQUIRED = 2;
export const NON_CARD_SIGNAL_FLOOR = 0.2;

/** Guard 4: at most this many suggestions surfaced per new object (§6.4 "strongest 1–3"). */
export const MAX_SUGGESTIONS = 3;

/** A tentative entity link counts at this share of a resolved one. */
export const TENTATIVE_WEIGHT = 0.5;

/** temporal_proximity = exp(−days apart / τ). */
export const PROXIMITY_TAU_DAYS = 45;
/** Candidates further apart than this are not scored at all. */
export const CANDIDATE_WINDOW_DAYS = 365;

/**
 * Timeframe fit outside the stated horizon decays linearly to zero over a grace period equal
 * to the horizon's own length, never shorter than this many days.
 */
export const TIMEFRAME_GRACE_MIN_DAYS = 14;

/** Re-suggestion after a rejection needs a new fingerprint and at least this much more score. */
export const RESUGGEST_DELTA = 0.15;

/** Bound on candidates per object (pairwise against one object is linear; this caps the read). */
export const MAX_CANDIDATES = 300;
