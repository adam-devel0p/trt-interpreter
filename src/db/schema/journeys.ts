import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { createdBy, journeyStatus } from './enums';
import { themes } from './memory';
import { readings } from './readings';

/**
 * Journeys (docs/DATA_MODEL.md#journeys--phase-07, spec §6.5, FR-10, FR-16, FR-17). A journey
 * is an evolving subject, not a tag: rule code creates and grows it from evidence
 * (`src/domain/journeys`), the model only ever proposes a title, and any user action pins
 * what it touched. Members are polymorphic — readings now, life events and outcomes in 08 —
 * and a removed member stays as a `removed` row so assignment never re-adds it.
 *
 * Policies: keyed on `user_id = auth.uid()`; members and progression steps additionally
 * require the parent journey (and, for reading members, the reading) to be the caller's.
 * Rule-side writes come from the assignment step after extraction (service role).
 */

const owned = (t: { userId: AnyPgColumn }) => sql`${t.userId} = ${authUid}`;

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** user (pinned) | model (proposed) | rule (placeholder). */
    titleSource: createdBy('title_source').notNull().default('rule'),
    /** The model's one-line reason for its title, if it proposed one. Never a fact. */
    rationale: text('rationale'),
    summary: text('summary'),
    status: journeyStatus('status').notNull().default('suggested'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Mean pairwise affinity of the cluster that created it; 1 for user-created. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    createdBy: createdBy('created_by').notNull(),
    /** Why it was created — sentences, no numbers. */
    reasons: text('reasons').array(),
    /** Set by any user action; pins the title against model renaming (§6.5). */
    userConfirmed: boolean('user_confirmed').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** A dismissed suggestion stays (hidden) so it is never re-suggested (§19). */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    /** Set when merged into another journey (kept for undo; hidden from lists). */
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => journeys.id, {
      onDelete: 'set null',
    }),
    /** Member ids that moved in the merge, for `undo_journey_merge`. */
    mergeSnapshot: jsonb('merge_snapshot'),
    /** Provenance of a model-proposed title. */
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    namedAt: timestamp('named_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('journeys_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    check('journeys_merged_check', sql`${t.mergedIntoId} is null or ${t.status} = 'closed'`),
    index('journeys_user_status_idx').on(t.userId, t.status, t.lastActivityAt.desc()),
    pgPolicy('journeys_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('journeys_insert', { for: 'insert', to: authenticatedRole, withCheck: owned(t) }),
    pgPolicy('journeys_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('journeys_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Journey = typeof journeys.$inferSelect;

const ownsJourney = (t: { journeyId: AnyPgColumn }) =>
  sql`exists (select 1 from ${journeys} j where j.id = ${t.journeyId} and j.user_id = ${authUid})`;
const ownsObject = (t: { objectType: AnyPgColumn; objectId: AnyPgColumn }) =>
  sql`(${t.objectType} <> 'reading' or exists (select 1 from ${readings} r where r.id = ${t.objectId} and r.user_id = ${authUid}))`;

/**
 * Membership. `state`: `auto` (affinity ≥ 0.70, rule-added, removable in one tap), `pending`
 * (0.50–0.70, asked about inline on the reading), `confirmed` (the user accepted or added
 * it), `removed` (the user took it out — the row stays so it is never re-added; undo flips it
 * back). `signals` and `reasons` carry the evidence for "why?".
 */
export const journeyMembers = pgTable(
  'journey_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    /** reading | life_event | outcome */
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    createdBy: createdBy('created_by').notNull(),
    state: text('state').notNull(),
    signals: jsonb('signals'),
    reasons: text('reasons').array(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'journey_members_object_type_check',
      sql`${t.objectType} in ('reading', 'life_event', 'outcome')`,
    ),
    check(
      'journey_members_state_check',
      sql`${t.state} in ('auto', 'pending', 'confirmed', 'removed')`,
    ),
    check('journey_members_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    uniqueIndex('journey_members_unique_idx').on(t.journeyId, t.objectType, t.objectId),
    index('journey_members_object_idx').on(t.objectType, t.objectId),
    index('journey_members_user_idx').on(t.userId, t.journeyId),
    pgPolicy('journey_members_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('journey_members_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsJourney(t)} and ${ownsObject(t)}`,
    }),
    pgPolicy('journey_members_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsJourney(t)} and ${ownsObject(t)}`,
    }),
    pgPolicy('journey_members_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type JourneyMember = typeof journeyMembers.$inferSelect;

/**
 * Theme progression steps (FR-17), recomputed by rule code whenever a journey changes.
 * `source_object_ids` is non-empty by check: a step without evidence is not representable.
 */
export const journeyThemeProgression = pgTable(
  'journey_theme_progression',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    sequenceIndex: integer('sequence_index').notNull(),
    themeId: uuid('theme_id')
      .notNull()
      .references(() => themes.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    sourceObjectIds: uuid('source_object_ids').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('journey_theme_progression_sources_check', sql`cardinality(${t.sourceObjectIds}) >= 1`),
    check('journey_theme_progression_period_check', sql`${t.periodEnd} >= ${t.periodStart}`),
    uniqueIndex('journey_theme_progression_seq_idx').on(t.journeyId, t.sequenceIndex),
    index('journey_theme_progression_user_idx').on(t.userId, t.journeyId),
    pgPolicy('journey_theme_progression_select', {
      for: 'select',
      to: authenticatedRole,
      using: owned(t),
    }),
    pgPolicy('journey_theme_progression_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsJourney(t)}`,
    }),
    pgPolicy('journey_theme_progression_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsJourney(t)}`,
    }),
    pgPolicy('journey_theme_progression_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: owned(t),
    }),
  ],
).enableRLS();

export type JourneyThemeProgressionStep = typeof journeyThemeProgression.$inferSelect;
