import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import { trackNow } from '@/analytics/track';
import { recordUsage } from '@/billing/usage';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectNoUserAccess,
  expectReadOwnOnly,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 11 tables. `usage_counters` and `subscriptions` are read-own / service-role-write:
 * a user sees their own allowance and plan and can change neither. `billing_events` and
 * `analytics_events` are invisible to every user. `push_subscriptions` are the user's own
 * (four policies); `notifications` are read-own, written by the dispatcher.
 */
describe('RLS: usage_counters, subscriptions, billing_events, analytics_events, push_subscriptions, notifications', () => {
  let f: RlsFixture;
  beforeAll(async () => {
    f = await createRlsFixture();
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('usage_counters: A reads own, cannot insert or change them; B and anon see nothing', async () => {
    await expectReadOwnOnly(
      f,
      'usage_counters',
      (userId) => ({
        user_id: userId,
        period_start: '2026-09-01',
        task: 'interpret_reading',
        calls: 3,
      }),
      async (row) => {
        await recordUsage({
          userId: row.user_id as string,
          task: row.task as string,
          ok: true,
          tokens: 10,
          costMicros: 5,
          now: new Date('2026-09-01T10:00:00Z'),
        });
        await recordUsage({
          userId: row.user_id as string,
          task: row.task as string,
          ok: true,
          tokens: 10,
          costMicros: 5,
          now: new Date('2026-09-01T11:00:00Z'),
        });
        await recordUsage({
          userId: row.user_id as string,
          task: row.task as string,
          ok: true,
          tokens: 10,
          costMicros: 5,
          now: new Date('2026-09-01T12:00:00Z'),
        });
        const [r] = await platformSql()<{ id: string; calls: number }[]>`
          select id, calls from public.usage_counters
          where user_id = ${row.user_id as string} and period_start = '2026-09-01' and task = ${row.task as string}`;
        expect(r?.calls).toBe(3);
        return { id: r!.id };
      },
      { mutableColumn: 'calls', mutatedValue: 0 },
    );
  });

  it('subscriptions: A reads own plan and cannot move it; B and anon see nothing', async () => {
    await expectReadOwnOnly(
      f,
      'subscriptions',
      (userId) => ({
        user_id: userId,
        provider: 'stripe',
        provider_customer_id: `cus_${userId.slice(0, 8)}`,
        status: 'active',
        plan: 'premium',
      }),
      async (row) => {
        const [r] = await platformSql()<{ id: string }[]>`
          insert into public.subscriptions (user_id, provider, provider_customer_id, status, plan)
          values (${row.user_id as string}, 'stripe', ${row.provider_customer_id as string}, 'active', 'premium')
          returning id`;
        return { id: r!.id };
      },
      { mutableColumn: 'status', mutatedValue: 'canceled' },
    );
    // Nor the plan mirror on the profile (Phase 01 trigger, still in force).
    const plan = await f.a.client.from('profiles').update({ plan: 'premium' }).eq('id', f.a.id);
    expect(plan.error?.code).toBe('42501');
  });

  it('billing_events and analytics_events: invisible and unwritable to users and anon', async () => {
    await platformSql()`
      insert into public.billing_events (id, provider, type, event_at, user_id, outcome)
      values ('evt_rls_test', 'stripe', 'customer.subscription.updated', now(), ${f.a.id}, 'applied')
      on conflict (id) do nothing`;
    await expectNoUserAccess(f, 'billing_events', {
      id: 'evt_rls_forged',
      provider: 'stripe',
      type: 'x',
      event_at: new Date().toISOString(),
      outcome: 'applied',
    });
    expect(await trackNow(f.a.id, 'export_requested', {})).toBe(true);
    await expectNoUserAccess(f, 'analytics_events', {
      user_id: f.a.id,
      name: 'export_requested',
      props: {},
    });
    const [n] = await platformSql()<{ n: number }[]>`
      select count(*)::int as n from public.analytics_events where user_id = ${f.a.id}`;
    expect(n?.n).toBe(1);
  });

  it('push_subscriptions: standard isolation (the user registers and removes their own devices)', async () => {
    await expectRlsIsolation(
      f,
      'push_subscriptions',
      (userId) => ({
        user_id: userId,
        endpoint: `https://push.example/${userId}/${Math.random()}`,
        p256dh: 'k',
        auth: 'a',
      }),
      { mutableColumn: 'p256dh', mutatedValue: 'stolen' },
    );
  });

  it('notifications: A reads own, cannot write; B and anon see nothing', async () => {
    await expectReadOwnOnly(
      f,
      'notifications',
      (userId) => ({
        user_id: userId,
        kind: 'revisit_due',
        channel: 'email',
        fingerprint: `revisit|${userId}`,
        path: '/reading/x',
        title: 't',
        body: 'b',
        status: 'sent',
        sent_on: '2026-09-14',
      }),
      async (row) => {
        const [r] = await platformSql()<{ id: string }[]>`
          insert into public.notifications (user_id, kind, channel, fingerprint, path, title, body, status, sent_on)
          values (${row.user_id as string}, 'revisit_due', 'email', ${row.fingerprint as string}, '/reading/x', 't', 'b', 'sent', '2026-09-14')
          returning id`;
        return { id: r!.id };
      },
      { mutableColumn: 'status', mutatedValue: 'failed' },
    );
  });
});
