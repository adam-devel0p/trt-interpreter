/**
 * Data floors and windows for summaries, narratives and the retention surfaces
 * (docs/ALGORITHMS.md §8, spec FR-20, §6.5, §15.2, §4.7). Every number a "nothing is shown"
 * decision depends on lives here, named, so tuning is a data change and the unit tests pin
 * each boundary. Below a floor nothing is generated and nothing is shown — no filler.
 */

export const SUMMARY_KINDS = ['weekly', 'monthly', 'journey', 'yearly'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

/** Live objects (readings + life events) a period needs before a summary is generated. */
export const SUMMARY_MIN_OBJECTS: Record<SummaryKind, number> = {
  weekly: 3,
  monthly: 5,
  journey: 5,
  yearly: 12,
};

/** A journey needs this many live objects before a narrative sentence is generated. */
export const NARRATIVE_MIN_OBJECTS = 3;
/** A stored narrative is regenerated after this many days even without a member change. */
export const NARRATIVE_REFRESH_DAYS = 14;

/** Evidence objects handed to the summariser, at most (the retrieval bound's number). */
export const SUMMARY_MAX_OBJECTS = 24;
/** Highlights per section, at most (the schema caps match). */
export const SUMMARY_MAX_CLAIMS_PER_SECTION = 4;

/** A card, suit or theme is called a pattern only from this many distinct occurrences (§3.3). */
export const PATTERN_MIN_OCCURRENCES = 3;
/** A confirmed life event within this many days of an occurrence counts as "around" it. */
export const PATTERN_EVENT_WINDOW_DAYS = 14;

/** Unresolved readings about one subject before a review is offered (§15.2). */
export const UNRESOLVED_REVIEW_MIN = 3;

/** A journey shift is news for this long after its period ends; older shifts are history. */
export const SHIFT_MAX_AGE_DAYS = 45;

/** On-this-day: the anniversary look-back (years) and the "30 days ago" fallback. */
export const ON_THIS_DAY_FALLBACK_DAYS = 30;
/** At most one resurfaced reading per calendar day (§4.7, §15.2). */
export const RESURFACE_MAX_PER_DAY = 1;

/** Covering summaries appended to an Ask evidence package, at most (compression, §8.1 step 4). */
export const ASK_COVERING_SUMMARIES_MAX = 2;
