import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  scorePair,
  selectSuggestions,
  type CorrelationObject,
} from '@/domain/correlation/score';
import {
  NON_CARD_SIGNAL_FLOOR,
  NON_CARD_SIGNALS_REQUIRED,
  WEIGHTS,
} from '@/domain/correlation/thresholds';

/**
 * Invariant (spec §8.2, ALGORITHMS §3 guard 1): card/symbol overlap alone can never produce a
 * correlation suggestion. Two layers:
 *   1. the pure engine — a pair whose only signal is a shared card (or all its cards) is never
 *      eligible, at any distance in time, and never reaches `offer`;
 *   2. the shape — the card signal's weight is the smallest, and the guard needs ≥ 2 non-card
 *      signals above the floor (so a card plus proximity alone is not enough either).
 * The runtime path (`src/correlation/run.ts`) stores only eligible pairs, asserted structurally.
 */
const day = (d: string) => `${d}T12:00:00.000Z`;
const reading = (
  id: string,
  cards: string[],
  at: string,
  over: Partial<CorrelationObject> = {},
): CorrelationObject => ({
  id,
  type: 'reading',
  occurredAt: day(at),
  entities: [],
  themes: [],
  journeys: [],
  cards,
  horizon: null,
  ...over,
});

describe('card-overlap-alone-never-correlates', () => {
  it('1 · identical spreads on any two dates are never eligible, whatever the raw score', () => {
    const cards = ['rws:the-tower', 'rws:the-star', 'rws:ace-of-cups'];
    for (const at of ['2026-05-01', '2026-05-02', '2026-05-20', '2026-08-01', '2027-01-01']) {
      const c = scorePair(reading('a', cards, '2026-05-01'), reading('b', cards, at));
      expect(c.signals.card_symbol_overlap).toBe(1);
      expect(c.eligible, `at ${at}`).toBe(false);
      expect(c.guardFailures).toContain('card_overlap_alone');
      expect(selectSuggestions([{ candidate: 'b', correlation: c }]).offer).toEqual([]);
      expect(selectSuggestions([{ candidate: 'b', correlation: c }]).store).toEqual([]);
    }
  });

  it('2 · a shared card plus one weak non-card signal is still not enough; two are', () => {
    const cards = ['rws:the-tower'];
    const withTheme = scorePair(
      reading('a', cards, '2026-05-01', { themes: [{ slug: 'change', weight: 0.9 }] }),
      reading('b', cards, '2026-11-01', { themes: [{ slug: 'change', weight: 0.9 }] }),
    );
    expect(withTheme.signals.theme_overlap).toBe(1);
    expect(withTheme.signals.temporal_proximity).toBeLessThan(NON_CARD_SIGNAL_FLOOR);
    expect(withTheme.eligible).toBe(false);
    const withThemeAndEntity = scorePair(
      reading('a', cards, '2026-05-01', {
        themes: [{ slug: 'change', weight: 0.9 }],
        entities: [{ id: 'maya', resolution: 'auto' }],
      }),
      reading('b', cards, '2026-11-01', {
        themes: [{ slug: 'change', weight: 0.9 }],
        entities: [{ id: 'maya', resolution: 'auto' }],
      }),
    );
    expect(withThemeAndEntity.guardFailures).not.toContain('card_overlap_alone');
  });

  it('3 · the card weight is the smallest and the guard needs two non-card signals', () => {
    const min = Math.min(...Object.values(WEIGHTS));
    expect(WEIGHTS.card_symbol_overlap).toBe(min);
    expect(NON_CARD_SIGNALS_REQUIRED).toBeGreaterThanOrEqual(2);
    expect(NON_CARD_SIGNAL_FLOOR).toBeGreaterThan(0);
    // The band never rescues an ineligible pair: the runtime filters on `eligible` first.
    const run = readFileSync(path.resolve('src/correlation/run.ts'), 'utf8');
    expect(run).toMatch(/selectSuggestions\(scored\)/);
    const score = readFileSync(path.resolve('src/domain/correlation/score.ts'), 'utf8');
    expect(score).toMatch(/\.filter\(\(s\) => s\.correlation\.eligible\)/);
    expect(bandFor(1)).toBe('likely'); // bands are display only
  });
});
