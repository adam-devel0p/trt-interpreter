import { describe, expect, it } from 'vitest';
import { EVENT_TYPE_KEYS } from '@/domain/extraction/schema';
import {
  createEventInputSchema,
  EVENT_DESCRIPTION_MAX,
  EVENT_TYPES,
  eventTypeLabel,
  todayIso,
} from '../types';

/** §6.4: one sentence and a date are all that is required; nothing about tarot. */
describe('life event input', () => {
  it('needs only a sentence and a date; note and reading are optional', () => {
    const parsed = createEventInputSchema.parse({
      description: 'I accepted the new job today.',
      occurred_on: '2026-09-13',
    });
    expect(parsed).toEqual({
      description: 'I accepted the new job today.',
      occurred_on: '2026-09-13',
      note: null,
      reading_id: null,
    });
    expect(
      createEventInputSchema.safeParse({ description: '   ', occurred_on: '2026-09-13' }).success,
    ).toBe(false);
    expect(
      createEventInputSchema.safeParse({
        description: 'x'.repeat(EVENT_DESCRIPTION_MAX + 1),
        occurred_on: '2026-09-13',
      }).success,
    ).toBe(false);
    expect(
      createEventInputSchema.safeParse({ description: 'ok', occurred_on: '13/09/2026' }).success,
    ).toBe(false);
    expect(
      createEventInputSchema.safeParse({ description: 'ok', occurred_on: '2026-09-13', extra: 1 })
        .success,
    ).toBe(false);
  });

  it('every extractor event type has a display label (stable key, separate label — §13)', () => {
    for (const key of EVENT_TYPE_KEYS) expect(eventTypeLabel(key), key).toBeTruthy();
    expect(EVENT_TYPES.map((t) => t.key)).toEqual([...EVENT_TYPE_KEYS]);
    expect(eventTypeLabel(null)).toBeNull();
    expect(eventTypeLabel('nonsense')).toBeNull();
  });

  it('todayIso gives a calendar date in the given zone', () => {
    const late = new Date('2026-09-13T23:30:00Z');
    expect(todayIso(late, 'UTC')).toBe('2026-09-13');
    expect(todayIso(late, 'Pacific/Auckland')).toBe('2026-09-14');
  });
});
