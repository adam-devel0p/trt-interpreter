/**
 * Journey assignment and creation thresholds (docs/ALGORITHMS.md §2). Every number the
 * decision boundaries depend on lives here, named, so tuning is a data change and the
 * boundary tests in `__tests__/affinity.test.ts` and `cluster.test.ts` pin each one.
 */

/** Signal weights of the affinity score. Unavailable signals are renormalised out. */
export const WEIGHTS = {
  entity_overlap: 0.35,
  semantic_similarity: 0.25,
  theme_overlap: 0.2,
  question_similarity: 0.1,
  temporal_activity: 0.1,
} as const;

/** ≥ AUTO_ASSIGN → auto-assign, silently visible and removable in one tap. */
export const AUTO_ASSIGN = 0.7;
/** ≥ PENDING (and < AUTO_ASSIGN) → a pending member, asked about inline on the reading. */
export const PENDING = 0.5;

/** Pairwise affinity every pair in a cluster needs for an `active` journey. */
export const CLUSTER_MIN_AFFINITY = 0.6;
/**
 * Pairwise floor for a `suggested` journey: about half of two readings' theme weight in
 * common while both are active ((0.20 · 0.5 + 0.10) / 0.75 ≈ 0.27) reaches it; the cluster
 * must still share an entity or a theme pair, so a lone theme in common never becomes a
 * suggestion.
 */
export const SUGGEST_MIN_AFFINITY = 0.25;
/** Objects a cluster needs to become an `active` journey on its own. */
export const CLUSTER_MIN_OBJECTS = 3;
/** Days between the cluster's first and last object for an `active` journey. */
export const CLUSTER_MIN_SPAN_DAYS = 14;
/** Objects a cluster needs to be offered as a `suggested` journey. */
export const SUGGEST_MIN_OBJECTS = 2;

/** A journey counts as active for the temporal signal within this many days of activity. */
export const ACTIVE_WINDOW_DAYS = 60;
/** The temporal signal reaches zero this many days after the window closes. */
export const ACTIVE_DECAY_DAYS = 120;
/** An active journey with no new object for this long is marked dormant. */
export const DORMANT_AFTER_DAYS = 120;

/**
 * An entity is part of a journey's "core" — the set the reading's entities are compared
 * against — when at least this share of the journey's objects mention it (a majority;
 * one passing mention in a long journey is not what the journey is about).
 */
export const CORE_ENTITY_SHARE = 0.5;

/** Theme progression (FR-17): a step needs this many supporting objects to be shown. */
export const PROGRESSION_MIN_SUPPORT = 2;
/** Themes per progression bucket. */
export const PROGRESSION_THEMES_PER_BUCKET = 2;
/** Objects per week at or above which buckets are weeks rather than months. */
export const PROGRESSION_DENSE_PER_WEEK = 1.5;

/** A card, suit or theme recurs when it appears in at least this many of a journey's objects. */
export const RECURRENCE_MIN = 2;

/** Bound on the unassigned objects considered per discovery pass (pairwise is quadratic). */
export const DISCOVERY_MAX_OBJECTS = 200;
