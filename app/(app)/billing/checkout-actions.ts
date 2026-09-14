'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { track } from '@/analytics/track';
import { requireUser } from '@/auth/session';
import { getBilling, pricing } from '@/billing';
import { siteUrl } from '@/billing/config';
import { loadSubscription } from '@/billing/subscriptions';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Checkout and the billing portal (§14, §4.8). Checkout is only ever reached from a paywall
 * the user opened at a premium action; the portal is where cancellation lives — one tap,
 * nothing of ours in between. Both end in a redirect to the provider's page.
 */
const intervalSchema = z.enum(['month', 'year']);

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const interval = intervalSchema.safeParse(formData.get('interval'));
  const returnTo = String(formData.get('return') ?? '/profile');
  if (!interval.success) redirect(`${returnTo}#billing`);
  const sub = await loadSubscription(user.id);
  const p = pricing();
  const trialDays = sub?.trialUsedAt ? 0 : p.trialDays;
  let url: string;
  try {
    const safeReturn = returnTo.startsWith('/') ? returnTo : '/profile';
    ({ url } = await getBilling().createCheckout({
      userId: user.id,
      email: user.email ?? null,
      interval: interval.data,
      trialDays,
      existingCustomerId: sub?.providerCustomerId ?? null,
      successUrl: `${siteUrl()}${safeReturn}${safeReturn.includes('?') ? '&' : '?'}billing=success`,
      cancelUrl: `${siteUrl()}${safeReturn}`,
    }));
  } catch (err) {
    logger.warn('billing.checkout_failed', { userId: user.id, errorClass: errorClassOf(err) });
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}billing=unavailable`);
  }
  track(user.id, 'checkout_started', { interval: interval.data, trial: trialDays > 0 });
  logger.info('billing.checkout_started', { userId: user.id, kind: interval.data });
  redirect(url);
}

export async function openBillingPortalAction(): Promise<void> {
  const user = await requireUser();
  const sub = await loadSubscription(user.id);
  if (!sub) redirect('/profile#billing');
  let url: string;
  try {
    ({ url } = await getBilling().createPortal({
      customerId: sub.providerCustomerId,
      returnUrl: `${siteUrl()}/profile#billing`,
    }));
  } catch (err) {
    logger.warn('billing.portal_failed', { userId: user.id, errorClass: errorClassOf(err) });
    redirect('/profile?billing=unavailable#billing');
  }
  redirect(url);
}

/** The sheet was opened at a premium action (§16 monetization funnel). */
export async function notePaywallViewedAction(feature: unknown, reason: unknown): Promise<void> {
  const user = await requireUser();
  const f = z
    .enum([
      'interpretation',
      'support',
      'memory',
      'ask_my_history',
      'correlation_explanations',
      'summaries',
    ])
    .safeParse(feature);
  const r = z.enum(['plan', 'monthly', 'daily']).safeParse(reason);
  if (f.success && r.success) track(user.id, 'paywall_viewed', { feature: f.data, reason: r.data });
}
