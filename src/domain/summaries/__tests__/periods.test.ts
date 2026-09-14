import { describe, expect, it } from 'vitest';
import {
  inPeriod,
  isComplete,
  parsePeriodKey,
  periodContaining,
  periodLabel,
  previousPeriod,
  recentCompletePeriods,
} from '../periods';

describe('periods', () => {
  it('months, ISO weeks and years contain a date and round-trip through their keys', () => {
    expect(periodContaining('monthly', '2026-08-14')).toEqual({
      kind: 'monthly',
      key: '2026-08',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    // Monday 2026-09-07 … Sunday 2026-09-13 is ISO week 37.
    expect(periodContaining('weekly', '2026-09-13T23:00:00Z')).toEqual({
      kind: 'weekly',
      key: '2026-W37',
      start: '2026-09-07',
      end: '2026-09-13',
    });
    expect(periodContaining('weekly', '2026-01-01')).toMatchObject({
      key: '2026-W01',
      start: '2025-12-29',
    });
    expect(periodContaining('yearly', '2026-03-03')).toMatchObject({
      key: '2026',
      start: '2026-01-01',
      end: '2026-12-31',
    });
    for (const key of ['2026-08', '2026-W37', '2026-W01', '2026', '2024-02'])
      expect(parsePeriodKey(key)?.key).toBe(key);
    expect(parsePeriodKey('2026-13')).toBeNull();
    expect(parsePeriodKey('2026-W54')).toBeNull();
    expect(parsePeriodKey('august')).toBeNull();
    expect(periodContaining('monthly', '2024-02-10').end).toBe('2024-02-29');
  });

  it('previous / complete / recent are calendar-honest', () => {
    const aug = periodContaining('monthly', '2026-08-14');
    expect(previousPeriod(aug).key).toBe('2026-07');
    expect(previousPeriod(periodContaining('monthly', '2026-01-05')).key).toBe('2025-12');
    expect(isComplete(aug, '2026-09-01')).toBe(true);
    expect(isComplete(aug, '2026-08-31')).toBe(false);
    // On 14 September the current month is not complete: the two most recent are Aug and Jul.
    expect(recentCompletePeriods('monthly', '2026-09-14', 2).map((p) => p.key)).toEqual([
      '2026-08',
      '2026-07',
    ]);
    // On the 1st, the month that just ended is complete.
    expect(recentCompletePeriods('monthly', '2026-09-01', 1)[0]!.key).toBe('2026-08');
    expect(recentCompletePeriods('weekly', '2026-09-14', 2).map((p) => p.key)).toEqual([
      '2026-W37',
      '2026-W36',
    ]);
    expect(inPeriod(aug, '2026-08-31T23:59:00Z')).toBe(true);
    expect(inPeriod(aug, '2026-09-01T00:00:00Z')).toBe(false);
  });

  it('labels read as a person would say them', () => {
    expect(periodLabel({ kind: 'monthly', start: '2026-08-01' })).toBe('August 2026');
    expect(periodLabel({ kind: 'weekly', start: '2026-09-07' })).toBe('Week of September 7, 2026');
    expect(periodLabel({ kind: 'yearly', start: '2026-01-01' })).toBe('2026');
  });
});
