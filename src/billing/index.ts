import 'server-only';
/**
 * Server-side entry point for billing. The provider is chosen by `BILLING_PROVIDER`; the fake
 * is refused in production so a misconfigured deployment fails loudly rather than granting
 * plans from a local page.
 */
import { serverEnv } from '@/config/env.server';
import { siteUrl } from './config';
import { createFakeBilling } from './fake';
import type { BillingProvider } from './provider';
import { createStripeBilling } from './stripe';

let provider: BillingProvider | undefined;

export function getBilling(): BillingProvider {
  if (provider) return provider;
  const env = serverEnv();
  if (env.BILLING_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_MONTHLY || !env.STRIPE_PRICE_ANNUAL)
      throw new Error(
        'BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL',
      );
    provider = createStripeBilling({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      prices: { month: env.STRIPE_PRICE_MONTHLY, year: env.STRIPE_PRICE_ANNUAL },
    });
    return provider;
  }
  if (env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_APP_ENV === 'production')
    throw new Error('BILLING_PROVIDER=fake is not allowed in production');
  const fake = createFakeBilling({ webhookSecret: env.STRIPE_WEBHOOK_SECRET, siteUrl: siteUrl() });
  provider = fake;
  return fake;
}

/** Test-only: forget the singleton. */
export function resetBillingForTests(): void {
  provider = undefined;
}

export { pricing } from './config';
export type { BillingProvider } from './provider';
