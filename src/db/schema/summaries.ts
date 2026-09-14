import { sql } from 'drizzle-orm';
import {
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { journeys } from './journeys';

/**
 * Summaries, narratives and retention surfaces (docs/DATA_MODEL.md#retrieval--summaries--phases-09-10,
 * spec FR-20, §6.5, §15.2, §19).
 *
 *   - a **period summary** is what `summarize_period` produced for one period of one scope
 *     (the user's week or month, or a journey): a headline, four sections of claims each
 *     carrying its basis (§9.2) and its evidence labels mapped back to object ids, and the
 *     **source set** it was generated from. `source_object_ids` is non-empty by check; the
 *     application boundary (`domain/summaries/provenance.ts`) additionally refuses a set made
 *     only of other summaries or interpretations (§19). A deleted source is scrubbed out of
 *     the set and the row marked `stale_at`; a summary whose set would empty is deleted;
 *   - a **journey narrative** is the §6.5 header sentence with its progression labels and
 *     source ids, regenerated on a material change (`fingerprint`) or after 14 days, never
 *     on a view;
 *   - a **retention prompt** is the memory of a retention surface (§15.2): what was shown,
 *     on which day, and whether the user dismissed it — so a dismissal is remembered, a
 *     journey shift is surfaced once, and at most one old reading resurfaces per day.
 *
 * Summaries and narratives are written by jobs (service role); the owner reads, dismisses
 * and deletes them. Prompts are the session's own rows.
 */

const owned = (t: { userId: AnyPgColumn }) => sql`${t.userId} = ${authUid}`;

export const periodSummaries = pgTable(
  'period_summaries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** `user` (a week / month / year of the whole journal) or `journey`. */
    scope: text('scope').notNull(),
    journeyId: uuid('journey_id').references(() => journeys.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** The headline sentence. */
    summary: text('summary').notNull(),
    /** `{recurred, shifted, open, confirmed}`: claims with `basis` and `citations` as object refs. */
    highlights: jsonb('highlights').notNull(),
    /** Every object the summary was generated from. Never empty (check). */
    sourceObjectIds: uuid('source_object_ids').array().notNull(),
    /** The same set with types: `[{type, id}]`. */
    sources: jsonb('sources').notNull(),
    /** Live objects in the period at generation time (the floor evidence). */
    objectCount: integer('object_count').notNull(),
    /** Hash of the evidence the model saw; an unchanged hash is not regenerated. */
    inputHash: text('input_hash').notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a source was deleted after generation; the screen says so. */
    staleAt: timestamp('stale_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('period_summaries_scope_check', sql`${t.scope} in ('user', 'journey')`),
    check(
      'period_summaries_kind_check',
      sql`${t.kind} in ('weekly', 'monthly', 'journey', 'yearly')`,
    ),
    check(
      'period_summaries_journey_scope_check',
      sql`(${t.scope} = 'journey') = (${t.journeyId} is not null)`,
    ),
    check('period_summaries_period_check', sql`${t.periodStart} <= ${t.periodEnd}`),
    /** §19: the empty source set is rejected at the database. */
    check('period_summaries_sources_check', sql`cardinality(${t.sourceObjectIds}) > 0`),
    uniqueIndex('period_summaries_period_idx').on(
      t.userId,
      t.kind,
      t.periodStart,
      sql`coalesce(${t.journeyId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('period_summaries_user_idx').on(t.userId, t.periodStart.desc()),
    index('period_summaries_sources_idx').using('gin', t.sourceObjectIds),
    pgPolicy('period_summaries_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('period_summaries_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('period_summaries_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type PeriodSummaryRow = typeof periodSummaries.$inferSelect;

export const journeyNarratives = pgTable(
  'journey_narratives',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    journeyId: uuid('journey_id')
      .notNull()
      .unique()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    sentence: text('sentence').notNull(),
    /** Progression labels in order, e.g. {hesitation, decision, action}. */
    progression: text('progression').array().notNull(),
    sourceObjectIds: uuid('source_object_ids').array().notNull(),
    sources: jsonb('sources').notNull(),
    /** Live member ids + confirmed outcome count at generation (`narrativeFingerprint`). */
    fingerprint: text('fingerprint').notNull(),
    objectCount: integer('object_count').notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('journey_narratives_sources_check', sql`cardinality(${t.sourceObjectIds}) > 0`),
    index('journey_narratives_sources_idx').using('gin', t.sourceObjectIds),
    pgPolicy('journey_narratives_select', {
      for: 'select',
      to: authenticatedRole,
      using: owned(t),
    }),
    pgPolicy('journey_narratives_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: owned(t),
    }),
  ],
).enableRLS();

export type JourneyNarrativeRow = typeof journeyNarratives.$inferSelect;

export const retentionPrompts = pgTable(
  'retention_prompts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** From the picker: identifies *this* occurrence of the surface (the set, the shift, the day). */
    fingerprint: text('fingerprint').notNull(),
    objectType: text('object_type'),
    objectId: uuid('object_id'),
    /** Ids only (reading ids of a review, theme slugs of a shift). Never content. */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    shownOn: date('shown_on')
      .notNull()
      .default(sql`current_date`),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'retention_prompts_kind_check',
      sql`${t.kind} in ('on_this_day', 'unresolved_review', 'journey_shift', 'retrospective')`,
    ),
    uniqueIndex('retention_prompts_fingerprint_idx').on(t.userId, t.kind, t.fingerprint),
    index('retention_prompts_user_day_idx').on(t.userId, t.kind, t.shownOn.desc()),
    pgPolicy('retention_prompts_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('retention_prompts_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: owned(t),
    }),
    pgPolicy('retention_prompts_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('retention_prompts_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type RetentionPromptRow = typeof retentionPrompts.$inferSelect;
