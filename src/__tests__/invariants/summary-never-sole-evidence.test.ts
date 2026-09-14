import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterEvidence,
  scorePair,
  selectSuggestions,
  type CorrelationObject,
} from '@/domain/correlation/score';

/**
 * Invariant (spec §10 "no self-validating loops", ALGORITHMS §3 guard 2): an interpretation
 * or a period summary may never be the sole evidence that a real-life event occurred. The
 * engine goes further and never counts generated text as evidence at all:
 *   1. entities and themes whose provenance is `interpretation` or `period_summary` are
 *      dropped before scoring, so a bundle made only of them yields nothing;
 *   2. a mixed bundle scores exactly as its user-text part alone;
 *   3. the feature loader only ever reads extractions of the user's own words and marks
 *      everything `user_text` (structural).
 */
const day = (d: string) => `${d}T12:00:00.000Z`;
const base = (id: string, type: CorrelationObject['type'], at: string): CorrelationObject => ({
  id,
  type,
  occurredAt: day(at),
  entities: [],
  themes: [],
  journeys: [],
  ...(type === 'reading' ? { cards: ['c'], horizon: null } : {}),
});

describe('summary-never-sole-evidence', () => {
  it('1 · a bundle whose only evidence came from generated text produces no link', () => {
    const reading: CorrelationObject = {
      ...base('r', 'reading', '2026-04-01'),
      entities: [{ id: 'agency', resolution: 'auto', provenance: 'interpretation' }],
      themes: [
        { slug: 'decision', weight: 0.9, provenance: 'period_summary' },
        { slug: 'ambition', weight: 0.8, provenance: 'interpretation' },
      ],
      horizon: { start: '2026-04-01', end: '2026-04-30', text: 'this month' },
    };
    const event: CorrelationObject = {
      ...base('e', 'life_event', '2026-04-10'),
      entities: [{ id: 'agency', resolution: 'user' }],
      themes: [
        { slug: 'decision', weight: 0.9 },
        { slug: 'ambition', weight: 0.8 },
      ],
    };
    const c = scorePair(reading, event);
    expect(c.signals.entity_overlap).toBe(0);
    expect(c.signals.theme_overlap).toBe(0);
    expect(c.evidence.sharedEntityIds).toEqual([]);
    expect(c.evidence.sharedThemeSlugs).toEqual([]);
    expect(c.eligible).toBe(false);
    expect(selectSuggestions([{ candidate: event, correlation: c }]).store).toEqual([]);
    // The timeframe (the user's question) and proximity are honest signals but not enough alone.
    expect(c.signals.timeframe_fit).toBe(1);
  });

  it('2 · generated evidence adds nothing to a bundle that also has the user’s words', () => {
    const userOnly: CorrelationObject = {
      ...base('r', 'reading', '2026-04-01'),
      entities: [{ id: 'agency', resolution: 'auto' }],
      themes: [{ slug: 'decision', weight: 0.7 }],
    };
    const padded: CorrelationObject = {
      ...userOnly,
      entities: [
        ...userOnly.entities,
        { id: 'sam', resolution: 'auto', provenance: 'interpretation' },
      ],
      themes: [...userOnly.themes, { slug: 'ambition', weight: 0.9, provenance: 'period_summary' }],
    };
    const event: CorrelationObject = {
      ...base('e', 'life_event', '2026-04-10'),
      entities: [
        { id: 'agency', resolution: 'auto' },
        { id: 'sam', resolution: 'auto' },
      ],
      themes: [
        { slug: 'decision', weight: 0.7 },
        { slug: 'ambition', weight: 0.9 },
      ],
    };
    const a = scorePair(userOnly, event);
    const b = scorePair(padded, event);
    expect(b.score).toBe(a.score);
    expect(b.signals).toEqual(a.signals);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(filterEvidence(padded)).toEqual(userOnly);
  });

  it('3 · the feature loader reads only extractions of the user’s words and marks them user_text', () => {
    const src = readFileSync(path.resolve('src/correlation/features.ts'), 'utf8');
    expect(src).not.toMatch(/interpretations/);
    expect(src).not.toMatch(/period_summaries|periodSummaries/);
    expect(src).toMatch(/provenance: 'user_text'/);
    expect((src.match(/provenance: /g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The engine filters regardless of what a loader hands it.
    const score = readFileSync(path.resolve('src/domain/correlation/score.ts'), 'utf8');
    expect(score).toMatch(/const a = filterEvidence\(rawA\);\s*const b = filterEvidence\(rawB\);/);
  });
});
