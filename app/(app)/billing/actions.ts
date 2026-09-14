'use server';

import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/auth/session';
import {
  checkoutCompletedEvent,
  DAY_S,
  fakeCustomerId,
  fakeSubscriptionId,
  subscriptionEvent,
} from '@/billing/fakeEvents';
import { signWebhookBody } from '@/billing/stripe';
import { loadSubscription } from '@/billing/subscriptions';
import { handleWebhookBody } from '@/billing/webhook';
import { serverEnv } from '@/config/env.server';
import { logger } from '@/observability/logger';

/**
 * The fake provider's side of checkout and the portal: each button emits Stripe-shaped
 * events, signs them with the webhook secret and hands them to the same handler the HTTP
 * route uses. Refuses to exist unless `BILLING_PROVIDER=fake`.
 */
function requireFake() {
  if (serverEnv().BILLING_PROVIDER !== 'fake') notFound();
}

async function emit(event: object): Promise<void> {
  const body = JSON.stringify(event);
  const sig = signWebhookBody(body, serverEnv().STRIPE_WEBHOOK_SECRET);
  const res = await handleWebhookBody(body, sig);
  logger.info('billing.fake.emitted', {
    kind: (event as { type: string }).type,
    status: res.status === 200 ? res.outcome : res.error,
  });
}

const safePath = (v: unknown, fallback: string) => {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : fallback;
};

export async function fakeCheckoutAction(formData: FormData): Promise<void> {
  requireFake();
  const user = await requireUser();
  const interval = z.enum(['month', 'year']).parse(formData.get('interval'));
  const trialDays = z.coerce
    .number()
    .int()
    .min(0)
    .max(60)
    .parse(formData.get('trial') ?? 0);
  const success = safePath(formData.get('success'), '/profile?billing=success');
  const existing = await loadSubscription(user.id);
  const customerId = existing?.providerCustomerId ?? fakeCustomerId(user.id);
  const subscriptionId = fakeSubscriptionId(user.id);
  const now = Math.floor(Date.now() / 1000);
  await emit(
    checkoutCompletedEvent({ userId: user.id, customerId, subscriptionId, createdAt: now }),
  );
  await emit(
    subscriptionEvent('customer.subscription.created', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: trialDays > 0 ? 'trialing' : 'active',
      interval,
      createdAt: now + 1,
      trialEnd: trialDays > 0 ? now + trialDays * DAY_S : null,
      currentPeriodEnd: now + (trialDays > 0 ? trialDays : interval === 'year' ? 365 : 30) * DAY_S,
    }),
  );
  redirect(success);
}

/** The portal's buttons: cancel at period end, resume, cancel now, fail a payment, renew. */
export async function fakePortalAction(formData: FormData): Promise<void> {
  requireFake();
  const user = await requireUser();
  const op = z
    .enum(['cancel_at_period_end', 'resume', 'cancel_now', 'payment_failed', 'renew', 'pay_now'])
    .parse(formData.get('op'));
  const returnTo = safePath(formData.get('return'), '/profile#billing');
  const sub = await loadSubscription(user.id);
  if (!sub || !sub.providerSubscriptionId) redirect(returnTo);
  const now = Math.floor(Date.now() / 1000);
  const periodEnd = sub.currentPeriodEnd
    ? Math.floor(sub.currentPeriodEnd.getTime() / 1000)
    : now + 30 * DAY_S;
  const base = {
    userId: user.id,
    customerId: sub.providerCustomerId,
    subscriptionId: sub.providerSubscriptionId,
    interval: sub.interval ?? 'month',
    createdAt: now,
    trialEnd: sub.trialEnd ? Math.floor(sub.trialEnd.getTime() / 1000) : null,
  } as const;
  switch (op) {
    case 'cancel_at_period_end':
      await emit(
        subscriptionEvent('customer.subscription.updated', {
          ...base,
          status: sub.status,
          currentPeriodEnd: periodEnd,
          cancelAt: periodEnd,
          canceledAt: now,
        }),
      );
      break;
    case 'resume':
      await emit(
        subscriptionEvent('customer.subscription.updated', {
          ...base,
          status: sub.status,
          currentPeriodEnd: periodEnd,
          cancelAt: null,
          canceledAt: null,
        }),
      );
      break;
    case 'cancel_now':
      await emit(
        subscriptionEvent('customer.subscription.deleted', {
          ...base,
          status: 'canceled',
          currentPeriodEnd: periodEnd,
          canceledAt: now,
        }),
      );
      break;
    case 'payment_failed':
      await emit(
        subscriptionEvent('customer.subscription.updated', {
          ...base,
          status: 'past_due',
          currentPeriodEnd: periodEnd,
        }),
      );
      break;
    case 'pay_now':
      await emit(
        subscriptionEvent('customer.subscription.updated', {
          ...base,
          status: 'active',
          trialEnd: null,
          currentPeriodEnd: periodEnd,
        }),
      );
      break;
    case 'renew':
      await emit(
        subscriptionEvent('customer.subscription.updated', {
          ...base,
          status: 'active',
          trialEnd: null,
          currentPeriodEnd: periodEnd + (sub.interval === 'year' ? 365 : 30) * DAY_S,
        }),
      );
      break;
  }
  redirect(returnTo);
}
