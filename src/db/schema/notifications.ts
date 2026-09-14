import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';

/**
 * Reminder delivery (docs/DATA_MODEL.md, spec §15.2, Phase 11).
 *
 *   - **push subscriptions** are the browser's Web Push endpoints, one row per device. The
 *     user registers and removes their own; the dispatcher (service role) marks an endpoint
 *     `disabled_at` when the push service says it is gone (404 / 410).
 *   - **notifications** are the delivery log and the once-only memory: one row per reminder
 *     actually sent (or attempted), unique per `(user, kind, fingerprint)`. The row carries
 *     the deep link and app-authored copy built from dates and counts — never the question,
 *     a note or a name (reminder copy is content-free by rule, see
 *     `src/domain/notifications/copy.ts`). `opened_at` is set when the link is followed.
 */

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
    pgPolicy('push_subscriptions_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('push_subscriptions_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('push_subscriptions_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('push_subscriptions_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const NOTIFICATION_KINDS = [
  'revisit_due',
  'weekly_reflection',
  'monthly_retrospective',
] as const;

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    fingerprint: text('fingerprint').notNull(),
    objectType: text('object_type'),
    objectId: uuid('object_id'),
    /** The in-app path the reminder opens (`/reading/<id>`, `/retrospective/2026-08`). */
    path: text('path').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** `sent` | `failed` */
    status: text('status').notNull(),
    errorClass: text('error_class'),
    /** The user's calendar day the reminder went out on (the one-per-day rule). */
    sentOn: text('sent_on').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notifications_fingerprint_idx').on(t.userId, t.kind, t.fingerprint),
    index('notifications_user_day_idx').on(t.userId, t.sentOn),
    check(
      'notifications_kind_check',
      sql`${t.kind} in ('revisit_due', 'weekly_reflection', 'monthly_retrospective')`,
    ),
    check('notifications_channel_check', sql`${t.channel} in ('push', 'email')`),
    check('notifications_status_check', sql`${t.status} in ('sent', 'failed')`),
    pgPolicy('notifications_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type NotificationRow = typeof notifications.$inferSelect;
