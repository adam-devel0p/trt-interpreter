/**
 * Tunable constants for the reading loop (docs/ALGORITHMS.md#6-digital-draw-rng-fr-04-62).
 * Change values here, never inline.
 */

/** Chance that a drawn card lands reversed when the reading uses reversals. */
export const REVERSAL_PROBABILITY = 0.5;

/** How long a physical reading may be back-dated (spec §6.2: "a reading done earlier"). */
export const MAX_BACKDATE_YEARS = 10;

/** Custom spreads: position count bounds (FR-05). */
export const CUSTOM_SPREAD_MIN_POSITIONS = 1;
export const CUSTOM_SPREAD_MAX_POSITIONS = 10;

/** Revisit chip offsets offered after saving a future-facing reading (FR-14). */
export const REVISIT_OFFSETS = [
  { key: '1w', label: 'in 1 week', days: 7 },
  { key: '1m', label: 'in 1 month', days: 30 },
  { key: '3m', label: 'in 3 months', days: 90 },
] as const;
