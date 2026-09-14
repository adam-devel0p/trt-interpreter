import 'server-only';
import { clientEnv } from '@/config/env';
import { serverEnv } from '@/config/env.server';
import { DEFAULT_PRICING, type Pricing } from '@/domain/billing/pricing';

/** The displayed prices and trial length (§14: configuration, not code). */
export function pricing(): Pricing {
  const env = serverEnv();
  return {
    currency: env.BILLING_CURRENCY || DEFAULT_PRICING.currency,
    monthlyCents: env.BILLING_MONTHLY_CENTS,
    annualCents: env.BILLING_ANNUAL_CENTS,
    trialDays: env.BILLING_TRIAL_DAYS,
  };
}

export function siteUrl(): string {
  return clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
}
