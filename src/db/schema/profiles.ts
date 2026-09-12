import { sql } from 'drizzle-orm';
import {
  boolean,
  pgPolicy,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { decks } from './decks';
import { experienceLevel, explanationDepth, flagSetBy, reminderChannel, usageStyle } from './enums';

/**
 * Identity & preferences (docs/DATA_MODEL.md#identity--preferences--phase-01).
 *
 * `profiles` is 1:1 with auth.users and holds no journal content (§11: identity is kept apart
 * from content). A row is created by the `on_auth_user_created` trigger (migration
 * 0002_auth_profiles), so a profile always exists; there is deliberately no delete policy —
 * accounts are deleted through the service role (Phase 12), which cascades from auth.users.
 * `plan` is protected by the `profiles_protect_plan` trigger: the authenticated role cannot
 * change it.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    usageStyle: usageStyle('usage_style'),
    experienceLevel: experienceLevel('experience_level'),
    /** Remembered deck preference (FR-03A). Null until chosen; cleared if the deck is removed. */
    defaultDeckId: uuid('default_deck_id').references(() => decks.id, { onDelete: 'set null' }),
    useReversals: boolean('use_reversals').notNull().default(true),
    /** Null = AI processing not consented (declined or not yet asked). */
    aiConsentAt: timestamp('ai_consent_at', { withTimezone: true }),
    aiExplanationDepth: explanationDepth('ai_explanation_depth').notNull().default('standard'),
    /** Index into the onboarding step order; a drop-off resumes here. */
    onboardingStep: smallint('onboarding_step').notNull().default(0),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    plan: text('plan').notNull().default('free'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('profiles_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
    }),
    pgPolicy('profiles_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.id} = ${authUid}`,
    }),
    pgPolicy('profiles_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
      withCheck: sql`${t.id} = ${authUid}`,
    }),
  ],
).enableRLS();

export type Profile = typeof profiles.$inferSelect;

/**
 * Per-user feature flag overrides. Users may read their own overrides (so the resolved flag
 * set can be shown), but only the service role writes them: a rollout control must not be
 * flippable by the person it gates.
 */
export const userFlags = pgTable(
  'user_flags',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    flag: text('flag').notNull(),
    enabled: boolean('enabled').notNull(),
    setBy: flagSetBy('set_by').notNull().default('rollout'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_flags_user_flag_idx').on(t.userId, t.flag),
    pgPolicy('user_flags_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type UserFlag = typeof userFlags.$inferSelect;

/** Reminder preferences. Table lands now so the Profile placeholder has a home; UI in Phase 11. */
export const reminderSettings = pgTable(
  'reminder_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    revisitReminders: boolean('revisit_reminders').notNull().default(true),
    weeklyReflection: boolean('weekly_reflection').notNull().default(false),
    monthlyRetrospective: boolean('monthly_retrospective').notNull().default(false),
    quietHoursStart: time('quiet_hours_start'),
    quietHoursEnd: time('quiet_hours_end'),
    channel: reminderChannel('channel').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('reminder_settings_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('reminder_settings_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('reminder_settings_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('reminder_settings_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type ReminderSettings = typeof reminderSettings.$inferSelect;
