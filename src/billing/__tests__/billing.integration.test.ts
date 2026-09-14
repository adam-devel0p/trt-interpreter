import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAiRunner, getMockProvider, resetAiForTests } from '@/ai';
import { buildSafetyRequest } from '@/ai/tasks/classify_safety';
import { trackNow } from '@/analytics/track';
import { loadEntitlements } from '@/billing/gate';
import { checkoutCompletedEvent, DAY_S, subscriptionEvent } from '@/billing/fakeEvents';
import { resetBillingForTests } from '@/billing';
import { signWebhookBody } from '@/billing/stripe';
import { applyBillingEvent, loadSubscription } from '@/billing/subscriptions';
import { readUsage, recordUsage } from '@/billing/usage';
import { handleWebhookBody } from '@/billing/webhook';
import { serverEnv } from '@/config/env.server';
import { closeAdmin, platformDb, platformSql } from '@/db/admin';
import {
  analyticsEvents,
  billingEvents,
  profiles,
  subscriptions,
  usageCounters,
} from '@/db/schema';
import { PLAN_LIMITS } from '@/domain/billing/entitlements';
import { normalizeStripeEvent } from '@/domain/billing/providerEvents';
import { grantPremium, seedUsage } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * Metering and subscriptions against Postgres (phase 11 test plan): counters increment per
 * successful call and reset with the month; a limit blocks *before* the provider is called
 * (the mock's call log is the spy); webhooks are idempotent under duplicate delivery and
 * safe under out-of-order delivery; every status transition lands on the row and the plan
 * mirror; the fake checkout is the real handler end to end.
 */
describe('billing (integration)', () => {
  let user: TestUser;
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    resetAiForTests();
    resetBillingForTests();
    getAiRunner();
    user = await createTestUser('billing');
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });
  beforeEach(async () => {
    await platformDb().delete(usageCounters).where(eq(usageCounters.userId, user.id));
    await platformDb().delete(subscriptions).where(eq(subscriptions.userId, user.id));
    await platformSql()`update profiles set plan = 'free' where id = ${user.id}`;
    getMockProvider()!.calls.length = 0;
  });

  it('counters: only an ok run consumes a unit; tokens and cost accrue; a past month does not count', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await recordUsage({
      userId: user.id,
      task: 'interpret_reading',
      ok: true,
      tokens: 100,
      costMicros: 5,
    });
    await recordUsage({
      userId: user.id,
      task: 'interpret_reading',
      ok: false,
      tokens: 0,
      costMicros: 0,
    });
    await recordUsage({
      userId: user.id,
      task: 'classify_safety',
      ok: true,
      tokens: 10,
      costMicros: 1,
    });
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await seedUsage(user.id, 'interpret_reading', 50, lastMonth.toISOString().slice(0, 10));
    const [row] = await platformDb()
      .select()
      .from(usageCounters)
      .where(eq(usageCounters.userId, user.id))
      .then((rows) => rows.filter((r) => r.task === 'interpret_reading' && r.periodStart === day));
    expect(row).toMatchObject({ calls: 1, tokens: 100, costMicros: 5 });
    const usage = await readUsage(user.id);
    expect(usage).toEqual({ month: { interpretation: 1, support: 1 }, today: 2 });
    const ent = await loadEntitlements(user.id);
    expect(ent.plan).toBe('free');
    expect(ent.features.interpretation.used).toBe(1);
  });

  it('a limit blocks before the provider call: zero mock calls, a budget_denied record, no counter change', async () => {
    const limit = PLAN_LIMITS.free.interpretationsPerMonth;
    await seedUsage(user.id, 'interpret_reading', limit);
    const mock = getMockProvider()!;
    const res = await getAiRunner().runObject({
      ...buildSafetyRequest('Will it rain?', {
        userId: user.id,
        readingId: '00000000-0000-4000-8000-000000000000',
      }),
      task: 'interpret_reading',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorClass).toBe('budget_denied');
    expect(mock.calls).toHaveLength(0);
    expect((await readUsage(user.id)).month.interpretation).toBe(limit);
    // A support task still runs (day cap only), and its counter moves.
    const ok = await getAiRunner().runObject(
      buildSafetyRequest('Will it rain?', {
        userId: user.id,
        readingId: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(ok.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    expect((await readUsage(user.id)).month.support).toBe(1);
    // A premium-only task on the free plan is refused for the plan, not a count.
    const ask = await getAiRunner().runObject({
      ...buildSafetyRequest('x', {
        userId: user.id,
        readingId: '00000000-0000-4000-8000-000000000000',
      }),
      task: 'answer_from_evidence',
    });
    expect(ask.ok).toBe(false);
    expect(mock.calls).toHaveLength(1);
    // Granted premium, the same task runs.
    await grantPremium(user.id);
    const asked = await getAiRunner().runObject({
      ...buildSafetyRequest('x', {
        userId: user.id,
        readingId: '00000000-0000-4000-8000-000000000000',
      }),
      task: 'answer_from_evidence',
    });
    // (the safety schema does not fit the ask fixture; what matters is that the provider was reached)
    if (!asked.ok) expect(asked.errorClass).not.toBe('budget_denied');
    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('webhooks: duplicate delivery is a no-op, an older event never overwrites a newer state, transitions land on the row and the plan mirror', async () => {
    const customerId = `cus_it_${user.id.slice(0, 8)}`;
    const subscriptionId = `sub_it_${user.id.slice(0, 8)}`;
    const t0 = now();
    const created = subscriptionEvent('customer.subscription.created', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: 'trialing',
      interval: 'year',
      createdAt: t0,
      trialEnd: t0 + 14 * DAY_S,
      currentPeriodEnd: t0 + 14 * DAY_S,
      eventId: `evt_it_created_${user.id.slice(0, 8)}`,
    });
    expect(await applyBillingEvent(normalizeStripeEvent(created))).toBe('applied');
    expect(await applyBillingEvent(normalizeStripeEvent(created))).toBe('duplicate');
    let sub = (await loadSubscription(user.id))!;
    expect(sub).toMatchObject({
      status: 'trialing',
      interval: 'year',
      providerCustomerId: customerId,
    });
    expect(sub.trialUsedAt).not.toBeNull();
    expect((await loadEntitlements(user.id)).plan).toBe('premium');
    expect(
      (
        await platformDb()
          .select({ plan: profiles.plan })
          .from(profiles)
          .where(eq(profiles.id, user.id))
      )[0]!.plan,
    ).toBe('premium');

    // Later: active (the trial converted), arriving first…
    const active = subscriptionEvent('customer.subscription.updated', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: 'active',
      interval: 'year',
      createdAt: t0 + 100,
      currentPeriodEnd: t0 + 365 * DAY_S,
    });
    expect(await applyBillingEvent(normalizeStripeEvent(active))).toBe('applied');
    // …then a stale past_due from before it: ignored, state stays active.
    const stale = subscriptionEvent('customer.subscription.updated', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: 'past_due',
      interval: 'year',
      createdAt: t0 + 50,
    });
    expect(await applyBillingEvent(normalizeStripeEvent(stale))).toBe('ignored_stale');
    sub = (await loadSubscription(user.id))!;
    expect(sub.status).toBe('active');

    // A genuine past_due later: premium analysis pauses, the archive gate has no say.
    const pastDue = subscriptionEvent('customer.subscription.updated', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: 'past_due',
      interval: 'year',
      createdAt: t0 + 200,
      currentPeriodEnd: t0 + 365 * DAY_S,
    });
    expect(await applyBillingEvent(normalizeStripeEvent(pastDue))).toBe('applied');
    let ent = await loadEntitlements(user.id);
    expect(ent.plan).toBe('free');
    expect(ent.features.ask_my_history.reason).toBe('plan');
    expect(ent.features.interpretation.allowed).toBe(true);

    // Deleted: canceled; a customer-only event (no metadata) still finds the user by customer id.
    const deleted = subscriptionEvent('customer.subscription.deleted', {
      userId: user.id,
      customerId,
      subscriptionId,
      status: 'canceled',
      interval: 'year',
      createdAt: t0 + 300,
      canceledAt: t0 + 300,
    });
    const raw = normalizeStripeEvent(deleted);
    expect(await applyBillingEvent({ ...raw, userId: null })).toBe('applied');
    sub = (await loadSubscription(user.id))!;
    expect(sub.status).toBe('canceled');
    expect(sub.canceledAt).not.toBeNull();
    ent = await loadEntitlements(user.id);
    expect(ent.plan).toBe('free');

    // The ledger holds every event once, with its outcome; the funnel events were tracked.
    const ledger = await platformDb()
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.userId, user.id));
    expect(ledger.map((e) => e.outcome).sort()).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'ignored_stale',
    ]);
    const funnel = await platformDb()
      .select({ name: analyticsEvents.name })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, user.id));
    expect(funnel.map((f) => f.name)).toEqual(
      expect.arrayContaining(['trial_started', 'subscription_converted', 'subscription_canceled']),
    );
    // An unknown customer with no user id is recorded as no_user and changes nothing.
    const stranger = subscriptionEvent('customer.subscription.created', {
      userId: user.id,
      customerId: 'cus_nobody',
      subscriptionId: 'sub_nobody',
      status: 'active',
      interval: 'month',
    });
    expect(await applyBillingEvent({ ...normalizeStripeEvent(stranger), userId: null })).toBe(
      'no_user',
    );
    // An ignored type is acknowledged.
    expect(
      await applyBillingEvent(
        normalizeStripeEvent({
          id: `evt_x_${user.id}`,
          type: 'invoice.paid',
          created: now(),
          data: { object: {} },
        }),
      ),
    ).toBe('ignored_unknown');
  });

  it('the HTTP body path: a bad signature is refused, a good one applies, a replay of the same signed body is a duplicate', async () => {
    const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
    const body = JSON.stringify(
      checkoutCompletedEvent({
        userId: user.id,
        customerId: `cus_http_${user.id.slice(0, 8)}`,
        subscriptionId: `sub_http_${user.id.slice(0, 8)}`,
      }),
    );
    expect(await handleWebhookBody(body, null)).toEqual({ status: 400, error: 'signature' });
    expect(
      await handleWebhookBody(body, signWebhookBody(body, 'whsec_wrong_secret_000000')),
    ).toEqual({ status: 400, error: 'signature' });
    const sig = signWebhookBody(body, secret);
    expect(await handleWebhookBody(body, sig)).toEqual({ status: 200, outcome: 'applied' });
    expect(await handleWebhookBody(body, sig)).toEqual({ status: 200, outcome: 'duplicate' });
    // A signature older than the tolerance is refused (replay of an old capture).
    const old = signWebhookBody(body, secret, now() - 3600);
    expect(await handleWebhookBody(body, old)).toEqual({ status: 400, error: 'signature' });
    expect(
      await handleWebhookBody('{"not":"an event"}', signWebhookBody('{"not":"an event"}', secret)),
    ).toEqual({ status: 400, error: 'shape' });
    const sub = await loadSubscription(user.id);
    expect(sub?.providerCustomerId).toBe(`cus_http_${user.id.slice(0, 8)}`);
    expect(sub?.status).toBe('incomplete'); // checkout binds ids; the status waits for the subscription event
  });

  it('analytics: a content prop is refused at runtime and never written', async () => {
    expect(
      await trackNow(user.id, 'reading_reopened', { age: 'week', question: 'Will he call?' }),
    ).toBe(false);
    expect(await trackNow(user.id, 'reading_reopened', { age: 'week' })).toBe(true);
    const rows = await platformDb()
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, user.id));
    expect(JSON.stringify(rows)).not.toContain('Will he call');
  });
});
