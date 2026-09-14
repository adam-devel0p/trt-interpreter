/**
 * Normalises a Stripe-shaped webhook event into the few fields the subscription row needs.
 * Pure: the signature has already been verified by the adapter (`src/billing/stripe.ts`).
 * Unknown event types come back as `ignored` so the webhook can acknowledge them without
 * touching anything. Tolerant of both Stripe API generations for the period end
 * (`current_period_end` on the subscription, or on its first item since 2025-03).
 */
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from './entitlements';

const unix = z.number().int().nullish();
const idOrObject = z
  .union([z.string(), z.object({ id: z.string() }).passthrough()])
  .nullish()
  .transform((v) => (v == null ? null : typeof v === 'string' ? v : v.id));

const subscriptionObject = z
  .object({
    id: z.string(),
    customer: idOrObject,
    status: z.string(),
    trial_end: unix,
    current_period_end: unix,
    cancel_at: unix,
    canceled_at: unix,
    metadata: z.record(z.string(), z.string()).nullish(),
    items: z
      .object({
        data: z.array(
          z
            .object({
              current_period_end: unix,
              price: z
                .object({ recurring: z.object({ interval: z.string() }).nullish() })
                .passthrough()
                .nullish(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const checkoutSessionObject = z
  .object({
    id: z.string(),
    mode: z.string().nullish(),
    client_reference_id: z.string().nullish(),
    customer: idOrObject,
    subscription: idOrObject,
    metadata: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const envelope = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    created: z.number().int(),
    data: z.object({ object: z.unknown() }).passthrough(),
  })
  .passthrough();

export type NormalizedKind = 'checkout_completed' | 'subscription_changed' | 'ignored';

export interface NormalizedBillingEvent {
  id: string;
  type: string;
  createdAt: string;
  kind: NormalizedKind;
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  interval: 'month' | 'year' | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
}

const iso = (n: number | null | undefined) => (n == null ? null : new Date(n * 1000).toISOString());
const uuid = z.string().uuid();
const asUserId = (v: string | null | undefined) => (v && uuid.safeParse(v).success ? v : null);

export class BillingEventShapeError extends Error {
  override readonly name = 'BillingEventShapeError';
}

export function normalizeStripeEvent(raw: unknown): NormalizedBillingEvent {
  const env = envelope.safeParse(raw);
  if (!env.success) throw new BillingEventShapeError('not a webhook event');
  const base: NormalizedBillingEvent = {
    id: env.data.id,
    type: env.data.type,
    createdAt: iso(env.data.created)!,
    kind: 'ignored',
    userId: null,
    customerId: null,
    subscriptionId: null,
    status: null,
    interval: null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAt: null,
    canceledAt: null,
  };
  const type = env.data.type;
  if (type === 'checkout.session.completed') {
    const s = checkoutSessionObject.safeParse(env.data.data.object);
    if (!s.success) throw new BillingEventShapeError('checkout session shape');
    if (s.data.mode && s.data.mode !== 'subscription') return base;
    return {
      ...base,
      kind: 'checkout_completed',
      userId: asUserId(s.data.client_reference_id) ?? asUserId(s.data.metadata?.user_id),
      customerId: s.data.customer,
      subscriptionId: s.data.subscription,
    };
  }
  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
    const s = subscriptionObject.safeParse(env.data.data.object);
    if (!s.success) throw new BillingEventShapeError('subscription shape');
    const sub = s.data;
    const rawStatus = type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
    const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as SubscriptionStatus)
      : null;
    if (!status) throw new BillingEventShapeError('subscription status');
    const item = sub.items?.data[0];
    const rawInterval = item?.price?.recurring?.interval;
    return {
      ...base,
      kind: 'subscription_changed',
      userId: asUserId(sub.metadata?.user_id),
      customerId: sub.customer,
      subscriptionId: sub.id,
      status,
      interval: rawInterval === 'month' || rawInterval === 'year' ? rawInterval : null,
      trialEnd: iso(sub.trial_end),
      currentPeriodEnd: iso(sub.current_period_end ?? item?.current_period_end),
      cancelAt: iso(sub.cancel_at),
      canceledAt: iso(sub.canceled_at),
    };
  }
  return base;
}

/** The analytics event a state change earns, if any (§16 monetization funnel). */
export function transitionEvent(
  before: { status: SubscriptionStatus | string; currentPeriodEnd: string | null } | null,
  after: { status: SubscriptionStatus; currentPeriodEnd: string | null },
):
  | 'trial_started'
  | 'subscription_converted'
  | 'subscription_renewed'
  | 'subscription_canceled'
  | null {
  if (after.status === 'trialing' && before?.status !== 'trialing') return 'trial_started';
  if (after.status === 'active') {
    if (before?.status === 'trialing') return 'subscription_converted';
    if (
      before?.status === 'active' &&
      before.currentPeriodEnd &&
      after.currentPeriodEnd &&
      after.currentPeriodEnd > before.currentPeriodEnd
    )
      return 'subscription_renewed';
    if (!before || before.status !== 'active') return 'subscription_converted';
  }
  if (after.status === 'canceled' && before?.status !== 'canceled') return 'subscription_canceled';
  return null;
}
