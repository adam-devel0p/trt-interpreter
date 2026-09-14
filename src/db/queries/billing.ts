/**
 * Billing reads as the user (RLS): the subscription row and this month's usage, for Profile.
 * Reads only — the plan and the counters are written by the webhook and the AI telemetry
 * through the service role; nothing here can move them.
 */
import type { UserClient } from '@/db/client';

export interface SubscriptionView {
  status: string;
  plan: string;
  interval: 'month' | 'year' | null;
  trial_end: string | null;
  trial_used_at: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  provider_customer_id: string;
}

class BillingReadError extends Error {
  override name = 'BillingReadError';
}

export async function getOwnSubscription(client: UserClient): Promise<SubscriptionView | null> {
  const { data, error } = await client
    .from('subscriptions')
    .select(
      'status, plan, interval, trial_end, trial_used_at, current_period_end, cancel_at, provider_customer_id',
    )
    .maybeSingle();
  if (error) throw new BillingReadError(error.message);
  return (data as SubscriptionView | null) ?? null;
}

/** Successful runs per task since the first of the UTC month. */
export async function getOwnMonthlyUsage(
  client: UserClient,
  now = new Date(),
): Promise<Record<string, number>> {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const { data, error } = await client
    .from('usage_counters')
    .select('task, calls')
    .gte('period_start', monthStart);
  if (error) throw new BillingReadError(error.message);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { task: string; calls: number }[])
    out[r.task] = (out[r.task] ?? 0) + r.calls;
  return out;
}
