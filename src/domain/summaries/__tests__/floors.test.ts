import { describe, expect, it } from 'vitest';
import { meetsNarrativeFloor, meetsSummaryFloor, summaryFloor } from '../floors';
import { NARRATIVE_MIN_OBJECTS, SUMMARY_MIN_OBJECTS } from '../thresholds';

/** FR-20 "after enough data exists": below the floor nothing is generated, nothing shown. */
describe('data floors', () => {
  it('weekly needs 3 objects, monthly 5, journey 5, yearly 12 — exactly at the boundary', () => {
    expect(SUMMARY_MIN_OBJECTS).toEqual({ weekly: 3, monthly: 5, journey: 5, yearly: 12 });
    for (const kind of ['weekly', 'monthly', 'journey', 'yearly'] as const) {
      const floor = summaryFloor(kind);
      expect(meetsSummaryFloor(kind, floor - 1)).toBe(false);
      expect(meetsSummaryFloor(kind, floor)).toBe(true);
      expect(meetsSummaryFloor(kind, 0)).toBe(false);
    }
  });
  it('a narrative needs three entries', () => {
    expect(NARRATIVE_MIN_OBJECTS).toBe(3);
    expect(meetsNarrativeFloor(2)).toBe(false);
    expect(meetsNarrativeFloor(3)).toBe(true);
  });
});
