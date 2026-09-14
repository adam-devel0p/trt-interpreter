/**
 * Stripe-shaped event bodies for the fake provider and the tests. Only the fields the
 * normaliser reads are filled in; ids follow Stripe's prefixes so logs read naturally.
 */
import { randomUUID } from 'node:crypto';
import type { SubscriptionStatus } from '@/domain/billing/entitlements';

export interface FakeSubscriptionInput {
  userId: string;
  customerId: string;
  subscriptionId: string;
  status: SubscriptionStatus;
  interval: 'month' | 'year';
  /** Unix seconds. */
  createdAt?: number;
  trialEnd?: number | null;
  currentPeriodEnd?: number | null;
  cancelAt?: number | null;
  canceledAt?: number | null;
  eventId?: string;
}

const now = () => Math.floor(Date.now() / 1000);
export const fakeCustomerId = (userId: string) =>
  `cus_fake_${userId.replace(/-/g, '').slice(0, 14)}`;
export const fakeSubscriptionId = (userId: string) =>
  `sub_fake_${userId.replace(/-/g, '').slice(0, 14)}`;

export function checkoutCompletedEvent(input: {
  userId: string;
  customerId: string;
  subscriptionId: string;
  createdAt?: number;
  eventId?: string;
}) {
  return {
    id: input.eventId ?? `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: 'checkout.session.completed',
    created: input.createdAt ?? now(),
    data: {
      object: {
        id: `cs_fake_${randomUUID().slice(0, 8)}`,
        object: 'checkout.session',
        mode: 'subscription',
        client_reference_id: input.userId,
        customer: input.customerId,
        subscription: input.subscriptionId,
        metadata: { user_id: input.userId },
      },
    },
  };
}

export function subscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  input: FakeSubscriptionInput,
) {
  const created = input.createdAt ?? now();
  return {
    id: input.eventId ?? `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type,
    created,
    data: {
      object: {
        id: input.subscriptionId,
        object: 'subscription',
        customer: input.customerId,
        status: input.status,
        trial_end: input.trialEnd ?? null,
        cancel_at: input.cancelAt ?? null,
        canceled_at: input.canceledAt ?? null,
        metadata: { user_id: input.userId },
        items: {
          object: 'list',
          data: [
            {
              id: `si_fake_${randomUUID().slice(0, 8)}`,
              current_period_end: input.currentPeriodEnd ?? null,
              price: {
                id: `price_fake_${input.interval}`,
                recurring: { interval: input.interval },
              },
            },
          ],
        },
      },
    },
  };
}

export const DAY_S = 86_400;
