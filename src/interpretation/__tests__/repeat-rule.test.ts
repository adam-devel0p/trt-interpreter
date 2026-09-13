import { describe, expect, it } from 'vitest';
import { mockEmbedding } from '@/ai/providers/mock';
import {
  cosineSimilarity,
  decideRepeat,
  normaliseQuestion,
  type PriorAsk,
} from '@/domain/interpretation/repeat';

const now = new Date('2026-09-13T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const q = 'Will he text me back?';
const v = mockEmbedding(q);
const ask = (over: Partial<PriorAsk>): PriorAsk => ({
  readingId: 'r',
  vector: v,
  askedAt: ago(1),
  nudgeShownAt: null,
  ...over,
});

describe('repeated-question rule (FR-25, ALGORITHMS §5)', () => {
  it('cosine of identical text is 1, of unrelated text is low', () => {
    expect(cosineSimilarity(v, mockEmbedding(q))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(v, mockEmbedding('Should I move to Lisbon for the job?'))).toBeLessThan(
      0.5,
    );
    expect(cosineSimilarity(v, mockEmbedding('will he text me back'))).toBeCloseTo(1, 6);
  });

  it('nudges on the third ask, not the second', () => {
    expect(decideRepeat(v, [ask({ readingId: 'a' })], now)).toMatchObject({
      nudge: false,
      reason: 'too_few',
    });
    const third = decideRepeat(
      v,
      [ask({ readingId: 'a', askedAt: ago(3) }), ask({ readingId: 'b' })],
      now,
    );
    expect(third.nudge).toBe(true);
    expect(third.priorReadingIds).toEqual(['b', 'a']);
  });

  it('ignores asks outside 24 hours and asks that never became readings', () => {
    expect(
      decideRepeat(v, [ask({ readingId: 'a', askedAt: ago(30) }), ask({ readingId: 'b' })], now)
        .nudge,
    ).toBe(false);
    expect(decideRepeat(v, [ask({ readingId: null }), ask({ readingId: 'b' })], now).nudge).toBe(
      false,
    );
  });

  it('nudges once per cluster per day', () => {
    const priors = [
      ask({ readingId: 'a', askedAt: ago(5) }),
      ask({ readingId: 'b', askedAt: ago(2), nudgeShownAt: ago(2) }),
    ];
    expect(decideRepeat(v, priors, now)).toMatchObject({ nudge: false, reason: 'nudged_today' });
  });

  it('a different question is not part of the cluster', () => {
    const other = mockEmbedding('Should I move to Lisbon for the job?');
    expect(decideRepeat(other, [ask({ readingId: 'a' }), ask({ readingId: 'b' })], now).nudge).toBe(
      false,
    );
  });

  it('normalises whitespace and case for the hash key', () => {
    expect(normaliseQuestion('  Will he   TEXT me back? ')).toBe('will he text me back?');
  });
});
