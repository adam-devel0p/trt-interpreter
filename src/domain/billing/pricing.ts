/**
 * Price display and subscription wording (spec §14, §4.8). The amounts are configuration
 * (`src/billing/config.ts` reads them from the environment) because §14 says not to optimise
 * pricing before retention is shown; this module only formats and words them. Every sentence
 * here is plain: the trial end date is stated, nothing counts down, nothing is scarce.
 */
import type { SubscriptionStatus } from './entitlements';

export type BillingInterval = 'month' | 'year';

export interface Pricing {
  /** ISO 4217, lower case (`eur`, `usd`). */
  currency: string;
  monthlyCents: number;
  annualCents: number;
  trialDays: number;
}

/** Placeholders near the mainstream journaling range (§14); overridden by env. */
export const DEFAULT_PRICING: Pricing = {
  currency: 'eur',
  monthlyCents: 599,
  annualCents: 3999,
  trialDays: 14,
};

export function formatAmount(cents: number, currency: string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Annual price per month, for the "equivalent to" line. */
export function annualPerMonthCents(p: Pricing): number {
  return Math.round(p.annualCents / 12);
}

/** Whole-percent saving of annual over twelve months of monthly; 0 when there is none. */
export function annualSavingPercent(p: Pricing): number {
  const yearly = p.monthlyCents * 12;
  if (yearly <= p.annualCents) return 0;
  return Math.round(((yearly - p.annualCents) / yearly) * 100);
}

export interface PriceLine {
  interval: BillingInterval;
  amount: string;
  perMonth: string;
  note: string | null;
}

export function priceLines(p: Pricing, locale = 'en'): PriceLine[] {
  const saving = annualSavingPercent(p);
  return [
    {
      interval: 'year',
      amount: `${formatAmount(p.annualCents, p.currency, locale)} a year`,
      perMonth: `${formatAmount(annualPerMonthCents(p), p.currency, locale)} a month`,
      note: saving > 0 ? `${saving}% less than monthly` : null,
    },
    {
      interval: 'month',
      amount: `${formatAmount(p.monthlyCents, p.currency, locale)} a month`,
      perMonth: 'cancel any time',
      note: null,
    },
  ];
}

export interface SubscriptionView {
  status: SubscriptionStatus | string;
  interval: BillingInterval | string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
}

const day = (iso: string, locale = 'en-GB') =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  );

/**
 * One plain sentence for the Profile row. The archive line is the same on every plan and is
 * appended by the page, not here.
 */
export function describeSubscription(sub: SubscriptionView | null, locale = 'en-GB'): string {
  if (!sub) return 'Free.';
  const when = (iso: string | null) => (iso ? day(iso, locale) : null);
  switch (sub.status) {
    case 'trialing': {
      const end = when(sub.trialEnd);
      if (sub.cancelAt)
        return `Premium trial, ending ${end ?? 'soon'}. You cancelled, so nothing will be charged.`;
      return end
        ? `Premium trial until ${end}. The ${sub.interval === 'year' ? 'yearly' : 'monthly'} price starts then unless you cancel before.`
        : 'Premium trial.';
    }
    case 'active': {
      if (sub.cancelAt)
        return `Premium until ${when(sub.cancelAt) ?? 'the end of the period'}, then Free. You cancelled; nothing more will be charged.`;
      const renews = when(sub.currentPeriodEnd);
      return renews
        ? `Premium, ${sub.interval === 'year' ? 'yearly' : 'monthly'}. Renews ${renews}.`
        : 'Premium.';
    }
    case 'past_due':
      return 'Premium is paused: the last payment did not go through. Everything you wrote is here; new analysis waits until billing is sorted.';
    case 'unpaid':
      return 'Premium ended because payment could not be taken. Your archive is untouched.';
    case 'canceled':
      return 'Free. Your earlier subscription ended; everything you wrote is still here.';
    case 'paused':
      return 'Premium is paused. Your archive is untouched.';
    case 'incomplete':
    case 'incomplete_expired':
      return 'Free. A checkout was started but not completed; nothing was charged.';
    default:
      return 'Free.';
  }
}
