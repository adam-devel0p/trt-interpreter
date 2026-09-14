import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { billingEvents, profiles, subscriptions } from '@/db/schema';
import { effectivePlan, type SubscriptionStatus } from '@/domain/billing/entitlements';
import { transitionEvent, type NormalizedBillingEvent } from '@/domain/billing/providerEvents';
import { track } from '@/analytics/track';
import { logger } from '@/observability/logger';

/**
 * The subscription row and the webhook that writes it (§14). `applyBillingEvent` is
 * idempotent (the provider's event id is the ledger's key), replay-safe (a second delivery
 * of an applied event is acknowledged and changes nothing) and order-safe (an event older
 * than the last applied one for the subscription is recorded as `ignored_stale`). The
 * `profiles.plan` mirror is written here and nowhere else.
 */

export interface SubscriptionRow {
  id: string;
  userId: string;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  plan: string;
  interval: 'month' | 'year' | null;
  trialEnd: Date | null;
  trialUsedAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  canceledAt: Date | null;
  lastEventAt: Date | null;
}

const toRow = (r: typeof subscriptions.$inferSelect): SubscriptionRow => ({
  id: r.id,
  userId: r.userId,
  providerCustomerId: r.providerCustomerId,
  providerSubscriptionId: r.providerSubscriptionId,
  status: r.status as SubscriptionStatus,
  plan: r.plan,
  interval: r.interval as 'month' | 'year' | null,
  trialEnd: r.trialEnd,
  trialUsedAt: r.trialUsedAt,
  currentPeriodEnd: r.currentPeriodEnd,
  cancelAt: r.cancelAt,
  canceledAt: r.canceledAt,
  lastEventAt: r.lastEventAt,
});

export async function loadSubscription(userId: string): Promise<SubscriptionRow | null> {
  const [row] = await platformDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ? toRow(row) : null;
}

async function findByCustomer(provider: string, customerId: string) {
  const [row] = await platformDb()
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.provider, provider), eq(subscriptions.providerCustomerId, customerId)),
    )
    .limit(1);
  return row ? toRow(row) : null;
}

async function mirrorPlan(userId: string, status: SubscriptionStatus | null): Promise<void> {
  const plan = effectivePlan(status ? { status } : null);
  await platformDb().update(profiles).set({ plan }).where(eq(profiles.id, userId));
}

export type ApplyOutcome =
  'applied' | 'duplicate' | 'ignored_stale' | 'ignored_unknown' | 'no_user';

/** Applies one verified, normalised event. See the module comment for the guarantees. */
export async function applyBillingEvent(ev: NormalizedBillingEvent): Promise<ApplyOutcome> {
  const db = platformDb();
  // The fake provider emits Stripe-shaped events, so both share one ledger key.
  const providerKey = 'stripe';
  const eventAt = new Date(ev.createdAt);

  // 1. Ledger first: a duplicate delivery stops here.
  const inserted = await db
    .insert(billingEvents)
    .values({
      id: ev.id,
      provider: providerKey,
      type: ev.type,
      eventAt,
      userId: null,
      outcome: 'received',
    })
    .onConflictDoNothing({ target: billingEvents.id })
    .returning({ id: billingEvents.id });
  if (inserted.length === 0) {
    logger.info('billing.webhook.duplicate', { objectType: 'billing_event', objectId: ev.id });
    return 'duplicate';
  }
  const finish = async (outcome: ApplyOutcome, userId: string | null) => {
    await db.update(billingEvents).set({ outcome, userId }).where(eq(billingEvents.id, ev.id));
    logger.info('billing.webhook.applied', {
      objectType: 'billing_event',
      objectId: ev.id,
      status: outcome,
      userId: userId ?? undefined,
      kind: ev.type,
    });
    return outcome;
  };

  if (ev.kind === 'ignored') return finish('ignored_unknown', null);

  // 2. Find the user: the event names them, or the customer is already known.
  const existing = ev.customerId ? await findByCustomer(providerKey, ev.customerId) : null;
  const userId = ev.userId ?? existing?.userId ?? null;
  if (!userId || !ev.customerId) return finish('no_user', userId);

  // 3. Ordering guard: never let an older event overwrite a newer state.
  const current = existing ?? (await loadSubscription(userId));
  if (current?.lastEventAt && current.lastEventAt.getTime() > eventAt.getTime())
    return finish('ignored_stale', userId);

  if (ev.kind === 'checkout_completed') {
    // Binds customer and subscription ids to the user; the status comes from subscription events.
    await db
      .insert(subscriptions)
      .values({
        userId,
        provider: providerKey,
        providerCustomerId: ev.customerId,
        providerSubscriptionId: ev.subscriptionId,
        status: current?.status ?? 'incomplete',
        lastEventAt: eventAt,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          providerCustomerId: ev.customerId,
          providerSubscriptionId: sql`coalesce(${ev.subscriptionId}, ${subscriptions.providerSubscriptionId})`,
          lastEventAt: eventAt,
        },
      });
    return finish('applied', userId);
  }

  // subscription_changed
  const status = ev.status!;
  const trialUsedAt =
    current?.trialUsedAt ?? (status === 'trialing' || ev.trialEnd ? eventAt : null);
  await db
    .insert(subscriptions)
    .values({
      userId,
      provider: providerKey,
      providerCustomerId: ev.customerId,
      providerSubscriptionId: ev.subscriptionId,
      status,
      interval: ev.interval,
      trialEnd: ev.trialEnd ? new Date(ev.trialEnd) : null,
      trialUsedAt,
      currentPeriodEnd: ev.currentPeriodEnd ? new Date(ev.currentPeriodEnd) : null,
      cancelAt: ev.cancelAt ? new Date(ev.cancelAt) : null,
      canceledAt: ev.canceledAt ? new Date(ev.canceledAt) : null,
      lastEventAt: eventAt,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        providerCustomerId: ev.customerId,
        providerSubscriptionId: ev.subscriptionId,
        status,
        interval: ev.interval,
        trialEnd: ev.trialEnd ? new Date(ev.trialEnd) : null,
        trialUsedAt,
        currentPeriodEnd: ev.currentPeriodEnd ? new Date(ev.currentPeriodEnd) : null,
        cancelAt: ev.cancelAt ? new Date(ev.cancelAt) : null,
        canceledAt: ev.canceledAt ? new Date(ev.canceledAt) : null,
        lastEventAt: eventAt,
      },
    });
  await mirrorPlan(userId, status);
  const transition = transitionEvent(
    current
      ? {
          status: current.status,
          currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
    { status, currentPeriodEnd: ev.currentPeriodEnd },
  );
  if (transition === 'subscription_canceled') track(userId, transition, {});
  else if (transition) track(userId, transition, { interval: ev.interval });
  return finish('applied', userId);
}
