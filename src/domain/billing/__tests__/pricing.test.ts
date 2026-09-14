import { describe, expect, it } from 'vitest';
import {
  annualSavingPercent,
  DEFAULT_PRICING,
  describeSubscription,
  formatAmount,
  priceLines,
} from '../pricing';

describe('pricing', () => {
  it('formats amounts in the configured currency, whole units without decimals', () => {
    expect(formatAmount(3999, 'eur')).toMatch(/39\.99/);
    expect(formatAmount(4000, 'eur')).toMatch(/40/);
    expect(formatAmount(4000, 'eur')).not.toMatch(/\.00/);
  });

  it('lists annual first with its per-month equivalent and the saving; monthly second', () => {
    const lines = priceLines(DEFAULT_PRICING);
    expect(lines.map((l) => l.interval)).toEqual(['year', 'month']);
    expect(lines[0]!.perMonth).toMatch(/a month/);
    expect(lines[0]!.note).toMatch(/% less than monthly/);
    expect(lines[1]!.perMonth).toBe('cancel any time');
    expect(annualSavingPercent({ ...DEFAULT_PRICING, annualCents: 599 * 12 })).toBe(0);
    expect(priceLines({ ...DEFAULT_PRICING, annualCents: 599 * 12 })[0]!.note).toBeNull();
  });

  it('describes every state in one plain sentence with real dates and no pressure', () => {
    const base = {
      interval: 'year' as const,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAt: null,
    };
    expect(describeSubscription(null)).toBe('Free.');
    expect(
      describeSubscription({ ...base, status: 'trialing', trialEnd: '2026-09-28T00:00:00Z' }),
    ).toMatch(/trial until 28 September 2026\. The yearly price starts then unless you cancel/);
    expect(
      describeSubscription({ ...base, status: 'active', currentPeriodEnd: '2027-01-14T00:00:00Z' }),
    ).toMatch(/Renews 14 January 2027/);
    expect(
      describeSubscription({ ...base, status: 'active', cancelAt: '2027-01-14T00:00:00Z' }),
    ).toMatch(/until 14 January 2027, then Free/);
    expect(describeSubscription({ ...base, status: 'past_due' })).toMatch(/paused/);
    expect(describeSubscription({ ...base, status: 'canceled' })).toMatch(/still here/);
    for (const status of [
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'canceled',
      'paused',
      'incomplete',
    ])
      expect(describeSubscription({ ...base, status })).not.toMatch(
        /hurry|last chance|only .* left|streak/i,
      );
  });
});
