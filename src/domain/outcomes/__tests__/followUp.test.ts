import { describe, expect, it } from 'vitest';
import { followUpForOutcome, OUTCOME_LABEL, OUTCOME_STATUSES, syncedFollowUp } from '../followUp';

/** FR-15: the full status set, and `follow_up_status` following what was recorded. */
describe('outcomes → follow-up', () => {
  it('has the five documented statuses, each with a label', () => {
    expect([...OUTCOME_STATUSES]).toEqual([
      'happened',
      'partly',
      'did_not_happen',
      'unresolved',
      'irrelevant',
    ]);
    for (const s of OUTCOME_STATUSES) expect(OUTCOME_LABEL[s]).toBeTruthy();
  });

  it('a reading-level outcome maps one-to-one', () => {
    expect(followUpForOutcome('happened')).toBe('resolved');
    expect(followUpForOutcome('did_not_happen')).toBe('resolved');
    expect(followUpForOutcome('partly')).toBe('partly_resolved');
    expect(followUpForOutcome('unresolved')).toBe('unresolved');
    expect(followUpForOutcome('irrelevant')).toBe('not_relevant');
  });

  it('possibility-level outcomes decide only when there is no reading-level one', () => {
    expect(
      syncedFollowUp({
        reading: 'partly',
        possibilities: [{ predictionId: 'a', status: 'happened' }],
      }),
    ).toBe('partly_resolved');
    expect(syncedFollowUp({ reading: null, possibilities: [] })).toBeNull();
    expect(
      syncedFollowUp({ reading: null, possibilities: [{ predictionId: 'a', status: null }] }),
    ).toBeNull();
    expect(
      syncedFollowUp({
        reading: null,
        possibilities: [
          { predictionId: 'a', status: 'happened' },
          { predictionId: 'b', status: null },
        ],
      }),
    ).toBe('partly_resolved');
    expect(
      syncedFollowUp({
        reading: null,
        possibilities: [
          { predictionId: 'a', status: 'happened' },
          { predictionId: 'b', status: 'did_not_happen' },
        ],
      }),
    ).toBe('resolved');
    expect(
      syncedFollowUp({
        reading: null,
        possibilities: [
          { predictionId: 'a', status: 'irrelevant' },
          { predictionId: 'b', status: 'irrelevant' },
        ],
      }),
    ).toBe('not_relevant');
    expect(
      syncedFollowUp({
        reading: null,
        possibilities: [
          { predictionId: 'a', status: 'happened' },
          { predictionId: 'b', status: 'unresolved' },
        ],
      }),
    ).toBe('partly_resolved');
    expect(
      syncedFollowUp({
        reading: null,
        possibilities: [{ predictionId: 'a', status: 'unresolved' }],
      }),
    ).toBe('unresolved');
  });
});
