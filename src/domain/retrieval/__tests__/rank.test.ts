import { describe, expect, it } from 'vitest';
import { EMPTY_QUERY } from '../query';
import {
  RANK_WEIGHTS,
  rankCandidates,
  recencyOf,
  structuralMatch,
  type RankCandidate,
} from '../rank';

const now = '2026-09-14T12:00:00.000Z';
const base = (over: Partial<RankCandidate> & { id: string }): RankCandidate => ({
  type: 'reading',
  occurredAt: '2026-09-01T12:00:00.000Z',
  similarity: 0.5,
  entityHits: 0,
  journeyHit: false,
  cardHits: 0,
  lifeAreaHit: false,
  keywordHits: 0,
  confirmedLinks: 0,
  ...over,
});
const noHints = { entities: 0, journeys: 0, cards: 0, keywords: 0 };

describe('rankCandidates', () => {
  it('weights are 0.60 / 0.20 / 0.15 / 0.05 and a perfect candidate scores 1', () => {
    expect(RANK_WEIGHTS).toEqual({
      semantic: 0.6,
      structural: 0.2,
      recency: 0.15,
      linkDensity: 0.05,
    });
    const [top] = rankCandidates(
      [base({ id: 'a', similarity: 1, entityHits: 1, occurredAt: now, confirmedLinks: 3 })],
      {
        query: { ...EMPTY_QUERY, entity_hints: ['Maya'] },
        now,
        hinted: { ...noHints, entities: 1 },
      },
    );
    expect(top!.score).toBeCloseTo(1, 6);
  });

  it('semantic similarity dominates when hints are absent; recency breaks near ties', () => {
    const ranked = rankCandidates(
      [
        base({ id: 'old-similar', similarity: 0.9, occurredAt: '2025-09-14T12:00:00.000Z' }),
        base({ id: 'recent-weak', similarity: 0.3, occurredAt: now }),
        base({ id: 'recent-similar', similarity: 0.9, occurredAt: now }),
      ],
      { query: EMPTY_QUERY, now, hinted: noHints },
    );
    expect(ranked.map((r) => r.id)).toEqual(['recent-similar', 'old-similar', 'recent-weak']);
    expect(ranked[0]!.parts.structural).toBeNull();
  });

  it('a structural hit lifts a candidate over a slightly more similar one that misses every hint', () => {
    const ranked = rankCandidates(
      [
        base({ id: 'miss', similarity: 0.62 }),
        base({ id: 'hit', similarity: 0.55, entityHits: 1, lifeAreaHit: true }),
      ],
      {
        query: { ...EMPTY_QUERY, entity_hints: ['Maya'], life_area: 'relationships' },
        now,
        hinted: { ...noHints, entities: 1 },
      },
    );
    expect(ranked[0]!.id).toBe('hit');
    expect(
      structuralMatch(ranked[0]!, {
        query: { ...EMPTY_QUERY, entity_hints: ['Maya'], life_area: 'relationships' },
        now,
        hinted: { ...noHints, entities: 1 },
      }),
    ).toBe(1);
  });

  it('no vector → the semantic term is renormalised out rather than counted as zero', () => {
    const [a] = rankCandidates([base({ id: 'a', similarity: null, occurredAt: now })], {
      query: EMPTY_QUERY,
      now,
      hinted: noHints,
    });
    expect(a!.parts.semantic).toBeNull();
    expect(a!.score).toBeCloseTo(1 * (0.15 / 0.2), 6);
  });

  it('recency decays over a year and inverts for a first-occurrence question', () => {
    expect(recencyOf(now, now, 'lookup')).toBe(1);
    expect(recencyOf('2025-09-14T12:00:00.000Z', now, 'lookup')).toBeCloseTo(Math.exp(-1), 3);
    expect(recencyOf('2025-09-14T12:00:00.000Z', now, 'first_occurrence')).toBeCloseTo(
      1 - Math.exp(-1),
      3,
    );
  });

  it('is stable: equal scores order by recency then id', () => {
    const ranked = rankCandidates([base({ id: 'b' }), base({ id: 'a' })], {
      query: EMPTY_QUERY,
      now,
      hinted: noHints,
    });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
