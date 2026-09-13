import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { factStatus } from './enums';
import { readings } from './readings';

/**
 * AI artifacts (docs/DATA_MODEL.md, Phase 04). Everything here is derived: it can be
 * regenerated, superseded or purged without touching a word the user wrote (invariant 4).
 */

export const interpretationStatus = pgEnum('interpretation_status', [
  'pending',
  'streaming',
  'complete',
  'failed',
]);

export const aiCallStatus = pgEnum('ai_call_status', [
  'ok',
  'invalid_output',
  'timeout',
  'provider_error',
  'budget_denied',
  'refusal',
]);

/**
 * One layered interpretation per generation. `fact_status` is fixed to TAROT_INTERPRETATION by
 * a check constraint (invariant 7): nothing in this table can ever be a confirmed fact. While
 * streaming, the layer columns hold the partial output so a disconnect loses nothing; once
 * `complete` the row is immutable and cached for good (opening a reading never re-calls).
 * Regeneration inserts a new row and points the previous one at it via `superseded_by`, so
 * every generation stays reproducible. `metadata_version` is the reading's version the text
 * was generated against; a later card edit makes the interpretation stale, never wrong-silently.
 */
export const interpretations = pgTable(
  'interpretations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    readingId: uuid('reading_id')
      .notNull()
      .references(() => readings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    status: interpretationStatus('status').notNull().default('pending'),
    factStatus: factStatus('fact_status').notNull().default('TAROT_INTERPRETATION'),
    metadataVersion: integer('metadata_version').notNull(),
    depth: text('depth').notNull(),
    synthesis: text('synthesis'),
    /** [{position_index, card_id, text, nuances[]}] */
    perCard: jsonb('per_card'),
    combined: text('combined'),
    reflectivePrompts: text('reflective_prompts').array(),
    modelId: text('model_id'),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costMicros: integer('cost_micros'),
    latencyMs: integer('latency_ms'),
    errorClass: text('error_class'),
    /** Thumbs: 1 / -1. The reason is the user's own words — journal content, never logged. */
    feedback: smallint('feedback'),
    feedbackReason: text('feedback_reason'),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
    supersededBy: uuid('superseded_by'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('interpretations_fact_status_check', sql`${t.factStatus} = 'TAROT_INTERPRETATION'`),
    check('interpretations_feedback_check', sql`${t.feedback} is null or ${t.feedback} in (-1, 1)`),
    check(
      'interpretations_complete_check',
      sql`${t.status} <> 'complete' or (${t.synthesis} is not null and ${t.perCard} is not null and ${t.combined} is not null and ${t.reflectivePrompts} is not null and ${t.modelId} is not null)`,
    ),
    // One current (non-superseded) complete interpretation per reading.
    uniqueIndex('interpretations_current_idx')
      .on(t.readingId)
      .where(sql`${t.status} = 'complete' and ${t.supersededBy} is null`),
    index('interpretations_reading_created_idx').on(t.readingId, t.createdAt.desc()),
    index('interpretations_user_created_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('interpretations_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('interpretations_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid} and exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid})`,
    }),
    pgPolicy('interpretations_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid} and exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid})`,
    }),
    pgPolicy('interpretations_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type Interpretation = typeof interpretations.$inferSelect;

/**
 * High-stakes topic flags (§10). Category, severity and object IDs only — the question itself
 * is never copied here. `surfaced_at` records that the resource card was shown for this object.
 */
export const safetyFlags = pgTable(
  'safety_flags',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    surfacedAt: timestamp('surfaced_at', { withTimezone: true }),
    resourceShown: text('resource_shown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'safety_flags_category_check',
      sql`${t.category} in ('medical','self_harm','legal','financial','immediate_safety')`,
    ),
    check('safety_flags_severity_check', sql`${t.severity} in ('low','medium','high')`),
    uniqueIndex('safety_flags_object_idx').on(t.objectType, t.objectId, t.category),
    index('safety_flags_user_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('safety_flags_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('safety_flags_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('safety_flags_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('safety_flags_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type SafetyFlag = typeof safetyFlags.$inferSelect;

/**
 * Question embeddings for repeated-question detection (FR-25). One row per ask: inserted when
 * the question is checked before drawing (`reading_id` null), linked to the reading on save by
 * the question's normalised hash. Holds a vector and a hash, never the question text. Phase 09
 * generalises this into `retrieval_documents` + `embeddings`.
 */
export const questionEmbeddings = pgTable(
  'question_embeddings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    readingId: uuid('reading_id').references(() => readings.id, { onDelete: 'cascade' }),
    questionHash: text('question_hash').notNull(),
    vector: vector('vector', { dimensions: 1536 }).notNull(),
    model: text('model').notNull(),
    nudgeShownAt: timestamp('nudge_shown_at', { withTimezone: true }),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('question_embeddings_user_asked_idx').on(t.userId, t.askedAt.desc()),
    index('question_embeddings_user_hash_idx').on(t.userId, t.questionHash),
    pgPolicy('question_embeddings_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('question_embeddings_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('question_embeddings_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid} and (${t.readingId} is null or exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid}))`,
    }),
    pgPolicy('question_embeddings_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type QuestionEmbedding = typeof questionEmbeddings.$inferSelect;

/**
 * Cost and reliability telemetry, one row per run (§13). RLS enabled with **no policies**:
 * written by the service role from `src/ai/telemetry.ts`, read by the dev usage page. Carries
 * **no prompt or completion text, ever** — asserted by a test that greps a stored row.
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    task: text('task').notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull().default(''),
    schemaVersion: text('schema_version').notNull().default(''),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: aiCallStatus('status').notNull(),
    errorClass: text('error_class'),
    attempts: smallint('attempts').notNull().default(1),
    /** [{type, id}] — IDs only. */
    objectRefs: jsonb('object_refs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_calls_created_idx').on(t.createdAt.desc()),
    index('ai_calls_task_created_idx').on(t.task, t.createdAt.desc()),
    index('ai_calls_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
).enableRLS();

export type AiCall = typeof aiCalls.$inferSelect;
