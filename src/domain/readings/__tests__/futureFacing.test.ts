import { describe, expect, it } from 'vitest';
import { isFutureFacing } from '../futureFacing';

const one = [{ key: 'the_card', name: 'The card' }];
const ppf = [
  { key: 'past', name: 'Past' },
  { key: 'present', name: 'Present' },
  { key: 'future', name: 'Future' },
];

describe('isFutureFacing', () => {
  it('is true for a future-shaped spread regardless of the question', () => {
    expect(isFutureFacing({ question: null, positions: ppf })).toBe(true);
    expect(
      isFutureFacing({ question: 'x', positions: [{ key: 'a', name: 'Likely outcome' }] }),
    ).toBe(true);
  });
  it('is true for a forward-looking question on a neutral spread', () => {
    expect(isFutureFacing({ question: 'Should I take the job?', positions: one })).toBe(true);
    expect(isFutureFacing({ question: 'Will this move work out', positions: one })).toBe(true);
  });
  it('is false for an open reflection or a present-tense question on a one-card spread', () => {
    expect(isFutureFacing({ question: null, positions: one })).toBe(false);
    expect(isFutureFacing({ question: 'How am I feeling about my mother?', positions: one })).toBe(
      false,
    );
  });
});
