import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { createdBy, factStatus, linkState, outcomeStatus } from './enums';
import { predictions } from './memory';
import { readings } from './readings';

/**
 * Life events, outcomes and links (docs/DATA_MODEL.md#events-predictions-outcomes-links--phase-08,
 * spec §6.4, §8.2, FR-11–FR-15). The reading-to-reality loop:
 *
 *   - a **life event** is one sentence the user wrote about something that happened. It is a
 *     `CONFIRMED_FACT` because they said so; the text is immutable (invariant 4, enforced by
 *     the `life_events_text_immutable` trigger). A model-proposed event would be born
 *     `INFERRED_EVENT` with `confirmed_at` null — the check constraints and the insert
 *     policy make a user session unable to write anything but a confirmed user event, and a
 *     model row unable to claim confirmation;
 *   - an **outcome** records what happened to a reading (or one of its possibilities):
 *     `recorded_by = 'user'` and `fact_status = 'CONFIRMED_FACT'` are fixed by check — a
 *     model can never record one (§9.2);
 *   - a **link** is the scored evidence edge between two objects (§8.2). Rule code creates
 *     them `pending` with `signals`, `reasons` and an `evidence_fingerprint`; only a user
 *     action moves one to `confirmed` / `maybe` / `rejected` (the state ⇔ `user_acted_at`
 *     check). A rejected row stays so the same evidence is never re-suggested (§19).
 *
 * Policies: keyed on `user_id = auth.uid()`; child rows additionally require the parent
 * object(s) to be the caller's, whichever type they are.
 */

const owned = (t: { userId: AnyPgColumn }) => sql`${t.userId} = ${authUid}`;

export const lifeEvents = pgTable(
  'life_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** The one sentence, exactly as written. Immutable. */
    description: text('description').notNull(),
    occurredOn: date('occurred_on').notNull(),
    /** Optional longer note in the user's words. Immutable. */
    note: text('note'),
    /** "Something happened about this reading": the user's own link at entry time. */
    readingId: uuid('reading_id').references(() => readings.id, { onDelete: 'set null' }),
    /** Derived by `extract_event_metadata` (promoted from the payload); never user text. */
    eventType: text('event_type'),
    importance: smallint('importance'),
    emotionalTone: text('emotional_tone'),
    lifeArea: text('life_area'),
    factStatus: factStatus('fact_status').notNull().default('CONFIRMED_FACT'),
    source: createdBy('source').notNull().default('user'),
    /** When the user confirmed it: entry time for their own events, null for an unconfirmed proposal. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow(),
    metadataVersion: integer('metadata_version').notNull().default(1),
    /** Set when the correlation job has run for this event (so the UI can say "nothing found" honestly). */
    correlatedAt: timestamp('correlated_at', { withTimezone: true }),
    /** Soft delete: out of every view at once; the `purge_deleted` job hard-deletes. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'life_events_fact_status_check',
      sql`${t.factStatus} in ('CONFIRMED_FACT', 'INFERRED_EVENT')`,
    ),
    check(
      'life_events_confirmed_check',
      sql`(${t.factStatus} = 'CONFIRMED_FACT') = (${t.confirmedAt} is not null)`,
    ),
    check('life_events_source_check', sql`${t.source} in ('user', 'model')`),
    check(
      'life_events_user_confirmed_check',
      sql`${t.source} <> 'user' or ${t.confirmedAt} is not null`,
    ),
    check(
      'life_events_importance_check',
      sql`${t.importance} is null or (${t.importance} >= 1 and ${t.importance} <= 5)`,
    ),
    index('life_events_user_timeline_idx')
      .on(t.userId, t.occurredOn.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
    index('life_events_reading_idx').on(t.readingId),
    pgPolicy('life_events_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    // A user session writes only its own, confirmed, user-sourced events (§9.2).
    pgPolicy('life_events_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${t.source} = 'user' and ${t.factStatus} = 'CONFIRMED_FACT'`,
    }),
    pgPolicy('life_events_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('life_events_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type LifeEvent = typeof lifeEvents.$inferSelect;

const ownsEvent = (t: { lifeEventId: AnyPgColumn }) =>
  sql`exists (select 1 from ${lifeEvents} e where e.id = ${t.lifeEventId} and e.user_id = ${authUid})`;

/** A photo attached to an event. Bytes live in the private `event-media` bucket; signed URLs only. */
export const eventMedia = pgTable(
  'event_media',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    lifeEventId: uuid('life_event_id')
      .notNull()
      .references(() => lifeEvents.id, { onDelete: 'cascade' }),
    /** `<user_id>/<event_id>/<media_id>.<ext>` in the `event-media` bucket. */
    storagePath: text('storage_path').notNull(),
    kind: text('kind').notNull().default('photo'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** The user's own description of the picture, for screen readers. */
    altText: text('alt_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('event_media_kind_check', sql`${t.kind} in ('photo')`),
    check('event_media_size_check', sql`${t.sizeBytes} > 0`),
    uniqueIndex('event_media_path_idx').on(t.storagePath),
    index('event_media_event_idx').on(t.lifeEventId),
    pgPolicy('event_media_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('event_media_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsEvent(t)}`,
    }),
    pgPolicy('event_media_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsEvent(t)}`,
    }),
    pgPolicy('event_media_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type EventMedia = typeof eventMedia.$inferSelect;

const ownsReadingId = (t: { readingId: AnyPgColumn }) =>
  sql`exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid})`;

/**
 * What happened (FR-15). Append-only: recording again adds a row and the newest per target
 * is current, so an earlier note is never overwritten. `recorded_by` and `fact_status` are
 * fixed by check: only a person records an outcome.
 */
export const outcomes = pgTable(
  'outcomes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    readingId: uuid('reading_id')
      .notNull()
      .references(() => readings.id, { onDelete: 'cascade' }),
    /** A specific possibility of the reading; null = the reading as a whole. */
    predictionId: uuid('prediction_id').references(() => predictions.id, { onDelete: 'cascade' }),
    /** The life event that is the outcome, if the user pointed at one. */
    lifeEventId: uuid('life_event_id').references(() => lifeEvents.id, { onDelete: 'set null' }),
    status: outcomeStatus('status').notNull(),
    note: text('note'),
    factStatus: factStatus('fact_status').notNull().default('CONFIRMED_FACT'),
    recordedBy: createdBy('recorded_by').notNull().default('user'),
    userConfirmedAt: timestamp('user_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('outcomes_fact_status_check', sql`${t.factStatus} = 'CONFIRMED_FACT'`),
    check('outcomes_recorded_by_check', sql`${t.recordedBy} = 'user'`),
    index('outcomes_reading_idx').on(t.userId, t.readingId, t.createdAt.desc()),
    index('outcomes_event_idx').on(t.lifeEventId),
    pgPolicy('outcomes_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('outcomes_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsReadingId(t)} and (${t.lifeEventId} is null or ${ownsEvent(t)})`,
    }),
    pgPolicy('outcomes_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsReadingId(t)} and (${t.lifeEventId} is null or ${ownsEvent(t)})`,
    }),
    pgPolicy('outcomes_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Outcome = typeof outcomes.$inferSelect;

/** Polymorphic ownership: the object of the given type must be the caller's. */
export const ownsTypedObject = (type: AnyPgColumn, id: AnyPgColumn) =>
  sql`((${type} = 'reading' and exists (select 1 from ${readings} r where r.id = ${id} and r.user_id = ${authUid})) or (${type} = 'life_event' and exists (select 1 from ${lifeEvents} e where e.id = ${id} and e.user_id = ${authUid})))`;

/**
 * The evidence edge (§8.2, FR-12, FR-13). `score`, `signals` and `reasons` are always
 * persisted so "why am I seeing this?" has an answer. `evidence_fingerprint` is a stable hash
 * of the evidence that produced the suggestion; a rejected link is only re-surfaced on a new
 * fingerprint that scores materially higher (§19). `offered_at` marks the (at most three)
 * suggestions shown for a new object; the rest are stored for re-scoring and never shown.
 * `explanation` is the `explain_correlation` task's sentence for a score the code computed.
 */
export const links = pgTable(
  'links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    fromType: text('from_type').notNull(),
    fromId: uuid('from_id').notNull(),
    toType: text('to_type').notNull(),
    toId: uuid('to_id').notNull(),
    linkType: text('link_type').notNull(),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    signals: jsonb('signals'),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Shared entity / journey / theme ids and which of them the user confirmed (for §19 re-surfacing). */
    evidence: jsonb('evidence'),
    createdBy: createdBy('created_by').notNull(),
    state: linkState('state').notNull().default('pending'),
    userActedAt: timestamp('user_acted_at', { withTimezone: true }),
    evidenceFingerprint: text('evidence_fingerprint').notNull(),
    /** The score and fingerprint at the time of the last rejection. */
    rejectedScore: numeric('rejected_score', { precision: 4, scale: 3 }),
    rejectedFingerprint: text('rejected_fingerprint'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    explanation: text('explanation'),
    explainedModelId: text('explained_model_id'),
    explainedPromptVersion: text('explained_prompt_version'),
    explainedSchemaVersion: text('explained_schema_version'),
    explainedAt: timestamp('explained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('links_from_type_check', sql`${t.fromType} in ('reading', 'life_event')`),
    check('links_to_type_check', sql`${t.toType} in ('reading', 'life_event')`),
    check('links_link_type_check', sql`${t.linkType} in ('reading_event', 'reading_reading')`),
    check('links_score_check', sql`${t.score} >= 0 and ${t.score} <= 1`),
    check('links_self_check', sql`${t.fromType} <> ${t.toType} or ${t.fromId} <> ${t.toId}`),
    // Never born by a model; only rule code and the user create edges.
    check('links_created_by_check', sql`${t.createdBy} in ('user', 'rule')`),
    // A decided state is a user act, and vice versa.
    check(
      'links_state_acted_check',
      sql`(${t.state} in ('confirmed', 'maybe', 'rejected')) = (${t.userActedAt} is not null)`,
    ),
    uniqueIndex('links_pair_idx').on(t.userId, t.fromType, t.fromId, t.toType, t.toId, t.linkType),
    index('links_fingerprint_idx').on(t.evidenceFingerprint),
    index('links_from_idx').on(t.userId, t.fromType, t.fromId),
    index('links_to_idx').on(t.userId, t.toType, t.toId),
    pgPolicy('links_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    // A user session may create a link of its own (a confirmed origin), never a rule row.
    pgPolicy('links_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${t.createdBy} = 'user' and ${ownsTypedObject(t.fromType, t.fromId)} and ${ownsTypedObject(t.toType, t.toId)}`,
    }),
    pgPolicy('links_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsTypedObject(t.fromType, t.fromId)} and ${ownsTypedObject(t.toType, t.toId)}`,
    }),
    pgPolicy('links_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Link = typeof links.$inferSelect;
