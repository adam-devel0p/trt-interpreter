import { describe, expect, it } from 'vitest';
import { normalizeStripeEvent, transitionEvent } from '../providerEvents';

const userId = '11111111-1111-4111-8111-111111111111';

const sub = (over: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  type: 'customer.subscription.updated',
  created: 1_800_000_000,
  data: {
    object: {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      trial_end: null,
      cancel_at: null,
      canceled_at: null,
      metadata: { user_id: userId },
      items: {
        data: [{ current_period_end: 1_802_592_000, price: { recurring: { interval: 'year' } } }],
      },
      ...over,
    },
  },
});

describe('normalizeStripeEvent()', () => {
  it('reads a subscription event: user, customer, status, interval and the period end from the item', () => {
    const n = normalizeStripeEvent(sub());
    expect(n).toMatchObject({
      id: 'evt_1',
      kind: 'subscription_changed',
      userId,
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      status: 'active',
      interval: 'year',
      currentPeriodEnd: new Date(1_802_592_000 * 1000).toISOString(),
      createdAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it('accepts the older API shape (period end on the subscription) and an expanded customer', () => {
    const n = normalizeStripeEvent(
      sub({ current_period_end: 1_900_000_000, items: null, customer: { id: 'cus_obj' } }),
    );
    expect(n.currentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect(n.customerId).toBe('cus_obj');
    expect(n.interval).toBeNull();
  });

  it('a deleted subscription is canceled whatever the object says', () => {
    const n = normalizeStripeEvent({ ...sub(), type: 'customer.subscription.deleted' });
    expect(n.status).toBe('canceled');
  });

  it('a completed checkout binds the customer and subscription to the client reference', () => {
    const n = normalizeStripeEvent({
      id: 'evt_2',
      type: 'checkout.session.completed',
      created: 1,
      data: {
        object: {
          id: 'cs_1',
          mode: 'subscription',
          client_reference_id: userId,
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      },
    });
    expect(n).toMatchObject({
      kind: 'checkout_completed',
      userId,
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });
    // A one-off payment checkout is not ours.
    expect(
      normalizeStripeEvent({
        id: 'evt_3',
        type: 'checkout.session.completed',
        created: 1,
        data: { object: { id: 'cs', mode: 'payment' } },
      }).kind,
    ).toBe('ignored');
  });

  it('ignores unknown types, rejects malformed envelopes and unknown statuses, and never trusts a non-uuid user id', () => {
    expect(
      normalizeStripeEvent({ id: 'e', type: 'invoice.paid', created: 1, data: { object: {} } })
        .kind,
    ).toBe('ignored');
    expect(() => normalizeStripeEvent({ nope: true })).toThrow(/not a webhook event/);
    expect(() => normalizeStripeEvent(sub({ status: 'weird' }))).toThrow(/status/);
    expect(normalizeStripeEvent(sub({ metadata: { user_id: 'admin' } })).userId).toBeNull();
  });
});

describe('transitionEvent()', () => {
  it('names the funnel step a change earns', () => {
    expect(transitionEvent(null, { status: 'trialing', currentPeriodEnd: null })).toBe(
      'trial_started',
    );
    expect(
      transitionEvent(
        { status: 'trialing', currentPeriodEnd: null },
        { status: 'active', currentPeriodEnd: 'a' },
      ),
    ).toBe('subscription_converted');
    expect(transitionEvent(null, { status: 'active', currentPeriodEnd: 'a' })).toBe(
      'subscription_converted',
    );
    expect(
      transitionEvent(
        { status: 'active', currentPeriodEnd: '2026-01-01' },
        { status: 'active', currentPeriodEnd: '2027-01-01' },
      ),
    ).toBe('subscription_renewed');
    expect(
      transitionEvent(
        { status: 'active', currentPeriodEnd: '2027-01-01' },
        { status: 'active', currentPeriodEnd: '2027-01-01' },
      ),
    ).toBeNull();
    expect(
      transitionEvent(
        { status: 'active', currentPeriodEnd: null },
        { status: 'canceled', currentPeriodEnd: null },
      ),
    ).toBe('subscription_canceled');
    expect(
      transitionEvent(
        { status: 'active', currentPeriodEnd: null },
        { status: 'past_due', currentPeriodEnd: null },
      ),
    ).toBeNull();
  });
});
