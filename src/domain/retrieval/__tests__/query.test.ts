import { describe, expect, it } from 'vitest';
import { askScopeSchema, EXAMPLE_QUESTIONS, historyQuerySchema, resolveTimePhrase } from '../query';

describe('history query', () => {
  const today = '2026-09-14';
  it('resolves relative time phrases against today', () => {
    expect(resolveTimePhrase('How have things changed since June?', today)).toEqual({
      start: '2026-06-01',
      end: null,
    });
    expect(resolveTimePhrase('What did I ask about in January?', today)).toEqual({
      start: '2026-01-01',
      end: '2026-01-31',
    });
    // A month in the future means last year's.
    expect(resolveTimePhrase('since November', today)).toEqual({ start: '2025-11-01', end: null });
    expect(resolveTimePhrase('in the last three months', today)).toEqual({
      start: '2026-06-14',
      end: null,
    });
    expect(resolveTimePhrase('this year', today)).toEqual({ start: '2026-01-01', end: null });
    expect(resolveTimePhrase('last year', today)).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(resolveTimePhrase('What did I ask about health this summer?', today)).toEqual({
      start: '2026-06-01',
      end: '2026-08-31',
    });
    expect(resolveTimePhrase('last winter', today)).toEqual({
      start: '2025-12-01',
      end: '2026-02-28',
    });
    expect(resolveTimePhrase('my old career readings', today)).toBeNull();
  });

  it('bounds every list and rejects unknown keys', () => {
    const ok = historyQuerySchema.safeParse({
      intent: 'compare',
      time_range: null,
      life_area: null,
      entity_hints: ['Bali', 'Thailand'],
      journey_hints: [],
      card_hints: [],
      comparison_axes: ['Bali', 'Thailand'],
      object_types: ['reading'],
      keywords: [],
    });
    expect(ok.success).toBe(true);
    expect(
      historyQuerySchema.safeParse({
        intent: 'lookup',
        time_range: null,
        life_area: 'romance',
        entity_hints: [],
        journey_hints: [],
        card_hints: [],
        comparison_axes: [],
        object_types: ['reading'],
        keywords: [],
      }).success,
    ).toBe(false);
    expect(
      historyQuerySchema.safeParse({
        intent: 'lookup',
        time_range: { start: 'June', end: null },
        life_area: null,
        entity_hints: [],
        journey_hints: [],
        card_hints: [],
        comparison_axes: [],
        object_types: ['reading'],
        keywords: [],
      }).success,
    ).toBe(false);
  });

  it('scopes are a closed set with ids', () => {
    expect(askScopeSchema.safeParse({ kind: 'all' }).success).toBe(true);
    expect(askScopeSchema.safeParse({ kind: 'journey', journeyId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(
      askScopeSchema.safeParse({ kind: 'range', start: '2026-01-01', end: null }).success,
    ).toBe(true);
    expect(askScopeSchema.safeParse({ kind: 'user', userId: 'x' }).success).toBe(false);
  });

  it('ships the six §6.6 example questions verbatim', () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(6);
    expect(EXAMPLE_QUESTIONS[2]).toBe('Compare my readings about Bali and Thailand.');
  });
});
