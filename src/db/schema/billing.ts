import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';

/**
 * Metering, subscriptions and analytics (docs/DATA_MODEL.md#platform-tables, spec §14, §16,
 * FR-28, invariant 11).
 *
 *   - **usage counters** are one row per user, UTC day and task: `calls` (runs that reached
 *     the provider and came back `ok`), `tokens` and `cost_micros`. A month is the sum of its
 *     days. Written by `src/ai/telemetry.ts` through the service role; the user can read
 *     their own so Profile can show the allowance honestly. Nothing here is content.
 *   - **subscriptions** mirror the billing provider's state, one row per user, written only
 *     by the webhook handler. `last_event_at` is the provider's event timestamp of the last
 *     applied event, so an out-of-order delivery is ignored. Users read their own row and can
 *     change nothing: the plan is never a user-writable field (`profiles_protect_plan`).
 *   - **billing events** are the idempotency ledger: the provider's event id is the key, so a
 *     replayed webhook is acknowledged and applied once.
 *   - **analytics events** carry a name and props validated against a per-event allowlist
 *     (`src/domain/analytics/events.ts`) that has no free-text field, so journal content
 *     cannot be logged even by mistake (FR-28, §19). Service role only.
 */

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** The UTC day. Monthly allowances sum the days of the month. */
    periodStart: date('period_start').notNull(),
    task: text('task').notNull(),
    calls: integer('calls').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usage_counters_period_idx').on(t.userId, t.periodStart, t.task),
    check('usage_counters_nonnegative_check', sql`${t.calls} >= 0 and ${t.tokens} >= 0`),
    pgPolicy('usage_counters_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type UsageCounter = typeof usageCounters.$inferSelect;

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('stripe'),
    providerCustomerId: text('provider_customer_id').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    status: text('status').notNull(),
    plan: text('plan').notNull().default('premium'),
    /** `month` | `year` — which price the customer chose. */
    interval: text('interval'),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    /** Set once a trial has been granted, so a second checkout never gets a second trial. */
    trialUsedAt: timestamp('trial_used_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** Provider event timestamp of the last applied event (ordering guard). */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscriptions_customer_idx').on(t.provider, t.providerCustomerId),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')`,
    ),
    check('subscriptions_plan_check', sql`${t.plan} in ('premium')`),
    check(
      'subscriptions_interval_check',
      sql`${t.interval} is null or ${t.interval} in ('month', 'year')`,
    ),
    pgPolicy('subscriptions_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type Subscription = typeof subscriptions.$inferSelect;

/** Idempotency ledger for webhooks: the provider's event id is the primary key. */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().default('stripe'),
    type: text('type').notNull(),
    /** Provider's own event time; used to drop out-of-order deliveries. */
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    /** `applied` | `ignored_stale` | `ignored_unknown` | `no_user` */
    outcome: text('outcome').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('billing_events_user_idx').on(t.userId, t.receivedAt)],
).enableRLS();

export type BillingEvent = typeof billingEvents.$inferSelect;

/**
 * Product analytics (FR-28, §16). `props` is validated against the per-event allowlist before
 * insert; the column is jsonb only because the shape differs per event. No user policy: the
 * table is written and read by the service role alone.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    props: jsonb('props')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('analytics_events_name_idx').on(t.name, t.createdAt),
    index('analytics_events_user_idx').on(t.userId, t.createdAt),
    check('analytics_events_name_check', sql`${t.name} ~ '^[a-z][a-z0-9_]{2,63}$'`),
  ],
).enableRLS();

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
