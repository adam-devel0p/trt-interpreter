import { platformSql } from '@/db/admin';

/**
 * Phase 06 fixtures. Extraction is flag-gated (`ai_extraction`, env default off); tests turn
 * it on per user through the same `user_flags` override a rollout would use.
 */
export async function enableExtraction(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'ai_extraction', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}

/** Phase 07 fixtures: journeys are flag-gated too (`journey_autocreate`, env default off). */
export async function enableJourneys(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'journey_autocreate', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}

/** Phase 08 fixtures: connection suggestions are flag-gated (`correlation_suggestions`). */
export async function enableCorrelation(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'correlation_suggestions', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}

/** Phase 10 fixtures: summaries and narratives are flag-gated (`period_summaries`). */
export async function enableSummaries(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'period_summaries', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}

/**
 * Phase 11 fixtures: Ask, connection explanations and summaries are premium (§14). A test
 * that exercises them gives its user the row the webhook would have written — an active
 * subscription — through the service role, exactly as the billing seeder does. `status`
 * lets a test put the user in any provider state (past_due, canceled, …).
 */
export async function grantPremium(
  userId: string,
  opts: { status?: string; interval?: 'month' | 'year'; trialUsed?: boolean } = {},
): Promise<void> {
  const status = opts.status ?? 'active';
  const interval = opts.interval ?? 'year';
  const customer = `cus_test_${userId.replace(/-/g, '').slice(0, 14)}`;
  const sub = `sub_test_${userId.replace(/-/g, '').slice(0, 14)}`;
  await platformSql()`
    insert into public.subscriptions
      (user_id, provider, provider_customer_id, provider_subscription_id, status, plan, interval,
       trial_used_at, current_period_end, last_event_at)
    values (${userId}, 'stripe', ${customer}, ${sub}, ${status}, 'premium', ${interval},
       ${opts.trialUsed ? new Date().toISOString() : null}, now() + interval '30 days', now() - interval '1 minute')
    on conflict (user_id) do update set
      status = excluded.status, interval = excluded.interval,
      trial_used_at = excluded.trial_used_at, last_event_at = excluded.last_event_at`;
  await platformSql()`
    update public.profiles set plan = ${status === 'active' || status === 'trialing' ? 'premium' : 'free'}
    where id = ${userId}`;
}

/** The usage a budget would see: `calls` successful runs of `task` on the given UTC day. */
export async function seedUsage(
  userId: string,
  task: string,
  calls: number,
  day = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await platformSql()`
    insert into public.usage_counters (user_id, period_start, task, calls, tokens, cost_micros)
    values (${userId}, ${day}, ${task}, ${calls}, 0, 0)
    on conflict (user_id, period_start, task) do update set calls = excluded.calls`;
}
