import { NARRATIVE_MIN_OBJECTS, SUMMARY_MIN_OBJECTS, type SummaryKind } from './thresholds';

/**
 * The data floor (FR-20 "after enough data exists"): a summary of a period is generated
 * only when the period holds enough live objects; otherwise nothing is generated and
 * nothing is shown — a screen with one reading in it has nothing to summarise, and a
 * generated paragraph about it would be filler (§4.3, §15.2 "not generic spam").
 */
export function meetsSummaryFloor(kind: SummaryKind, objectCount: number): boolean {
  return objectCount >= SUMMARY_MIN_OBJECTS[kind];
}

export function meetsNarrativeFloor(objectCount: number): boolean {
  return objectCount >= NARRATIVE_MIN_OBJECTS;
}

/** The floor a screen can name ("Once five entries fall in a month…"). */
export function summaryFloor(kind: SummaryKind): number {
  return SUMMARY_MIN_OBJECTS[kind];
}
