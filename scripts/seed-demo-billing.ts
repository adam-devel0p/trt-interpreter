import { inArray } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import { billingEvents, subscriptions, usageCounters } from '../src/db/schema';
import type { SeedContext } from './seed-demo';
import { DEMO_USERS } from './seed-demo';

/**
 * Phase 11 — plans for the demo accounts, written the way the webhook would leave them.
 * Ana is a paying yearly subscriber (so the later seeders' summaries and explanations are
 * entitled, and Ask My History works on her journal); Ben and Cleo are on Free with no
 * billing history, which is what a new account looks like. Usage counters start empty.
 * Ana also carries reminder preferences (email, weekly reflection on) and the share-cards
 * rollout flag so every Phase 11 surface has something to show.
 */
export async function seedBilling(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedBilling needs the users seeder first');
  await db.delete(subscriptions).where(inArray(subscriptions.userId, userIds));
  await db.delete(usageCounters).where(inArray(usageCounters.userId, userIds));
  await db.delete(billingEvents).where(inArray(billingEvents.userId, userIds));
  await platformSql()`update profiles set plan = 'free' where id = any(${userIds})`;

  const anaIndex = DEMO_USERS.findIndex((u) => u.email === 'demo-ana@tarot.local');
  const ana = userIds[anaIndex];
  if (!ana) throw new Error('demo-ana missing');
  const now = new Date();
  const started = new Date(now);
  started.setUTCMonth(started.getUTCMonth() - 4);
  const renews = new Date(started);
  renews.setUTCFullYear(renews.getUTCFullYear() + 1);
  await db.insert(subscriptions).values({
    userId: ana,
    provider: 'stripe',
    providerCustomerId: `cus_demo_${ana.replace(/-/g, '').slice(0, 14)}`,
    providerSubscriptionId: `sub_demo_${ana.replace(/-/g, '').slice(0, 14)}`,
    status: 'active',
    plan: 'premium',
    interval: 'year',
    trialEnd: null,
    trialUsedAt: started,
    currentPeriodEnd: renews,
    lastEventAt: started,
  });
  await platformSql()`update profiles set plan = 'premium' where id = ${ana}`;
  await platformSql()`
    insert into reminder_settings (user_id, revisit_reminders, weekly_reflection, monthly_retrospective, channel, quiet_hours_start, quiet_hours_end)
    values (${ana}, true, true, true, 'email', '22:00', '08:00')
    on conflict (user_id) do update set
      revisit_reminders = excluded.revisit_reminders,
      weekly_reflection = excluded.weekly_reflection,
      monthly_retrospective = excluded.monthly_retrospective,
      channel = excluded.channel,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end`;
  await platformSql()`
    insert into user_flags (user_id, flag, enabled, set_by)
    values (${ana}, 'share_cards', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
  console.log(
    `  ${DEMO_USERS[anaIndex]!.email} → Premium (yearly, renews ${renews.toISOString().slice(0, 10)}); others Free`,
  );
}
