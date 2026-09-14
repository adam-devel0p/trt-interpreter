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
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { createdBy, entityKind, factStatus } from './enums';
import { readings } from './readings';

/**
 * Structured memory (docs/DATA_MODEL.md#derived-metadata--phase-06). Everything here is
 * derived from the user's own words and can be regenerated, superseded, corrected or purged
 * without touching a word they wrote (invariant 4). The model *proposes*; deterministic code
 * in `src/domain/entities` decides; the user's corrections (`metadata_overrides`) are
 * authoritative and survive every reprocess (FR-26).
 *
 * Policies: every table is keyed on `user_id = auth.uid()`. Child tables of a reading carry an
 * `exists` check on the parent so a row can never be attached to someone else's reading; child
 * tables of an entity do the same against `entities`. Model-side writes come from the
 * extraction job (service role); user-side writes (corrections, merges, renames) run through
 * these policies.
 */

const owned = (t: { userId: AnyPgColumn }) => sql`${t.userId} = ${authUid}`;
/**
 * Polymorphic parent check: the reading or (Phase 08) life event a row hangs off must be the
 * caller's. `life_events` is named directly (its module imports this one).
 */
const ownsReading = (t: { objectType: AnyPgColumn; objectId: AnyPgColumn }) =>
  sql`((${t.objectType} = 'reading' and exists (select 1 from ${readings} r where r.id = ${t.objectId} and r.user_id = ${authUid})) or (${t.objectType} = 'life_event' and exists (select 1 from life_events e where e.id = ${t.objectId} and e.user_id = ${authUid})))`;

/**
 * Append-only extraction runs (§7.2, FR-08). A `pending` row is written before any model
 * call; a `complete` row carries the validated payload and supersedes the previous current
 * one (`superseded_by`); failures stay as `failed` rows with a class. `metadata_version` and
 * `source_hash` say what the payload was extracted from, so a later edit makes it stale
 * rather than silently kept. Nothing here is ever a confirmed fact.
 */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** reading | life_event (08) */
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    status: text('status').notNull().default('pending'),
    schemaVersion: text('schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    modelId: text('model_id'),
    /** The reading's `metadata_version` the run read. */
    metadataVersion: integer('metadata_version').notNull(),
    /** Hash of the question + notes the run read (notes edits do not bump the version). */
    sourceHash: text('source_hash').notNull(),
    /** The validated `ExtractionPayload`; null until complete. */
    payload: jsonb('payload'),
    errorClass: text('error_class'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costMicros: integer('cost_micros'),
    latencyMs: integer('latency_ms'),
    supersededBy: uuid('superseded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('extractions_object_type_check', sql`${t.objectType} in ('reading', 'life_event')`),
    check('extractions_status_check', sql`${t.status} in ('pending', 'complete', 'failed')`),
    check(
      'extractions_complete_check',
      sql`${t.status} <> 'complete' or (${t.payload} is not null and ${t.modelId} is not null)`,
    ),
    // One current complete extraction per object.
    uniqueIndex('extractions_current_idx')
      .on(t.objectType, t.objectId)
      .where(sql`${t.status} = 'complete' and ${t.supersededBy} is null`),
    index('extractions_object_idx').on(t.objectType, t.objectId, t.createdAt.desc()),
    index('extractions_user_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('extractions_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('extractions_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Extraction = typeof extractions.$inferSelect;

/**
 * User corrections to extracted metadata (FR-26). `field_path` is a stable key (`life_area`,
 * `themes/<slug>`, `entities/<normalized mention>`, `possibilities/<hash>`, `timeframe`) and
 * `value` the correction. The read path and the materialiser always layer these over the
 * newest extraction, so a reprocess can never undo a correction. Written only by the user.
 */
export const metadataOverrides = pgTable(
  'metadata_overrides',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    fieldPath: text('field_path').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'metadata_overrides_object_type_check',
      sql`${t.objectType} in ('reading', 'life_event')`,
    ),
    uniqueIndex('metadata_overrides_field_idx').on(t.objectType, t.objectId, t.fieldPath),
    index('metadata_overrides_user_idx').on(t.userId, t.objectType, t.objectId),
    pgPolicy('metadata_overrides_select', {
      for: 'select',
      to: authenticatedRole,
      using: owned(t),
    }),
    pgPolicy('metadata_overrides_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('metadata_overrides_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('metadata_overrides_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: owned(t),
    }),
  ],
).enableRLS();

export type MetadataOverride = typeof metadataOverrides.$inferSelect;

/**
 * Themes (§13 taxonomy): a stable `slug` is the key, `label` the display text. Curated global
 * themes have `user_id` null and are seeded; a label the model produces that matches none of
 * them becomes a user-scoped theme. Readable by everyone for the global rows, own rows only
 * otherwise; only the service role writes global rows.
 */
export const themes = pgTable(
  'themes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    /** emotional | relational | situational | practical */
    category: text('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'themes_category_check',
      sql`${t.category} in ('emotional', 'relational', 'situational', 'practical')`,
    ),
    unique('themes_slug_key').on(t.userId, t.slug).nullsNotDistinct(),
    pgPolicy('themes_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} is null or ${t.userId} = ${authUid}`,
    }),
    pgPolicy('themes_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('themes_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('themes_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type Theme = typeof themes.$inferSelect;

/** A theme on a reading (or, in 08, an event). Model-born rows are never `user_confirmed`. */
export const objectThemes = pgTable(
  'object_themes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    themeId: uuid('theme_id')
      .notNull()
      .references(() => themes.id, { onDelete: 'cascade' }),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull(),
    source: createdBy('source').notNull(),
    userConfirmed: boolean('user_confirmed').notNull().default(false),
    extractionId: uuid('extraction_id').references(() => extractions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('object_themes_object_type_check', sql`${t.objectType} in ('reading', 'life_event')`),
    check('object_themes_weight_check', sql`${t.weight} >= 0 and ${t.weight} <= 1`),
    uniqueIndex('object_themes_object_theme_idx').on(t.objectType, t.objectId, t.themeId),
    index('object_themes_user_theme_idx').on(t.userId, t.themeId),
    pgPolicy('object_themes_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('object_themes_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('object_themes_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('object_themes_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type ObjectTheme = typeof objectThemes.$inferSelect;

/**
 * A stable, user-scoped thing (§7.1): a person, an organisation, a place… Raw strings are
 * aliases, never identity. `user_confirmed` pins the entity against automatic changes
 * (rename, auto-merge); `status = 'merged'` rows stay so a merge can be undone and history
 * still resolves.
 */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: entityKind('kind').notNull(),
    canonicalLabel: text('canonical_label').notNull(),
    /** active | merged | archived */
    status: text('status').notNull().default('active'),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => entities.id, {
      onDelete: 'set null',
    }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userConfirmed: boolean('user_confirmed').notNull().default(false),
    /** The user's own note about who this is. Theirs; never generated. */
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('entities_status_check', sql`${t.status} in ('active', 'merged', 'archived')`),
    check('entities_merged_check', sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null)`),
    index('entities_user_status_idx').on(t.userId, t.status, t.lastSeenAt.desc()),
    index('entities_label_trgm_idx').using('gin', sql`${t.canonicalLabel} gin_trgm_ops`),
    pgPolicy('entities_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('entities_insert', { for: 'insert', to: authenticatedRole, withCheck: owned(t) }),
    pgPolicy('entities_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('entities_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Entity = typeof entities.$inferSelect;

const ownsEntity = (t: { entityId: AnyPgColumn }) =>
  sql`exists (select 1 from ${entities} e where e.id = ${t.entityId} and e.user_id = ${authUid})`;

/** Every surface form an entity has been called by. `alias_normalized` is the match key. */
export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    aliasNormalized: text('alias_normalized').notNull(),
    /** Relational framing the alias came with ("my girlfriend" → partner), if any. */
    context: text('context'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    source: createdBy('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('entity_aliases_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    uniqueIndex('entity_aliases_entity_alias_idx').on(t.entityId, t.aliasNormalized),
    index('entity_aliases_user_norm_idx').on(t.userId, t.aliasNormalized),
    index('entity_aliases_norm_trgm_idx').using('gin', sql`${t.aliasNormalized} gin_trgm_ops`),
    pgPolicy('entity_aliases_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('entity_aliases_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsEntity(t)}`,
    }),
    pgPolicy('entity_aliases_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsEntity(t)}`,
    }),
    pgPolicy('entity_aliases_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type EntityAlias = typeof entityAliases.$inferSelect;

/**
 * Temporal roles (§7.1): partner, employer, colleague… A changed role adds a row and closes
 * the previous one (`valid_to`); a row's `role` is never rewritten. `evidence_*` points at
 * the object the role was learned from, so "why am I seeing this?" has an answer.
 */
export const entityRoles = pgTable(
  'entity_roles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    source: createdBy('source').notNull(),
    evidenceObjectType: text('evidence_object_type'),
    evidenceObjectId: uuid('evidence_object_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('entity_roles_range_check', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    index('entity_roles_entity_idx').on(t.entityId, t.validFrom.desc()),
    index('entity_roles_user_idx').on(t.userId, t.entityId),
    pgPolicy('entity_roles_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('entity_roles_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsEntity(t)}`,
    }),
    pgPolicy('entity_roles_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsEntity(t)}`,
    }),
    pgPolicy('entity_roles_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type EntityRole = typeof entityRoles.$inferSelect;

/**
 * A mention of an entity in a reading (or event). `resolution` records how the link was made:
 * `auto` and `tentative` are model+rule decisions and are never confirmed facts; `user` is a
 * correction; `rejected` is a dismissal. `ask_candidates` carries at most one open
 * disambiguation per object, answered on the reading detail screen, never mid-flow (§4.1).
 * `signals` holds the per-signal scores so the UI can show why.
 */
export const entityMentions = pgTable(
  'entity_mentions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    mentionText: text('mention_text').notNull(),
    mentionNormalized: text('mention_normalized').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    /** auto | tentative | user | rejected */
    resolution: text('resolution').notNull(),
    signals: jsonb('signals'),
    reasons: text('reasons').array(),
    askCandidates: uuid('ask_candidates').array(),
    extractionId: uuid('extraction_id').references(() => extractions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('entity_mentions_object_type_check', sql`${t.objectType} in ('reading', 'life_event')`),
    check(
      'entity_mentions_resolution_check',
      sql`${t.resolution} in ('auto', 'tentative', 'user', 'rejected')`,
    ),
    check('entity_mentions_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    uniqueIndex('entity_mentions_object_mention_idx').on(
      t.objectType,
      t.objectId,
      t.mentionNormalized,
    ),
    index('entity_mentions_entity_idx').on(t.entityId, t.createdAt.desc()),
    index('entity_mentions_user_object_idx').on(t.userId, t.objectType, t.objectId),
    pgPolicy('entity_mentions_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('entity_mentions_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${ownsEntity(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('entity_mentions_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and ${ownsEntity(t)} and ${ownsReading(t)}`,
    }),
    pgPolicy('entity_mentions_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: owned(t),
    }),
  ],
).enableRLS();

export type EntityMention = typeof entityMentions.$inferSelect;

/**
 * Receipt of a merge (FR-27): what moved from `source` to `target`, by id, so the merge can
 * be undone exactly. Counts and ids only.
 */
export const entityMerges = pgTable(
  'entity_merges',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    sourceEntityId: uuid('source_entity_id').notNull(),
    targetEntityId: uuid('target_entity_id').notNull(),
    /** { aliases: uuid[], mentions: uuid[], roles: uuid[], overrides: [{id, previous}] , target_was_confirmed: bool } */
    snapshot: jsonb('snapshot').notNull(),
    mergedAt: timestamp('merged_at', { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [
    index('entity_merges_user_idx').on(t.userId, t.mergedAt.desc()),
    pgPolicy('entity_merges_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('entity_merges_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: owned(t),
    }),
    pgPolicy('entity_merges_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('entity_merges_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type EntityMerge = typeof entityMerges.$inferSelect;

/**
 * Possibilities a reading raised (§9.2 POSSIBILITY). `fact_status` is fixed by check — a
 * prediction can never become a fact here — and there is **no probability column, ever**
 * (§10). Rows are keyed by `(reading_id, text_hash)` so a reprocess keeps ids stable for
 * Phase 08's outcomes; `user_edited` marks the user's own wording; `dismissed_at` a dismissal.
 */
export const predictions = pgTable(
  'predictions',
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
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(),
    category: text('category'),
    timeframeStart: date('timeframe_start'),
    timeframeEnd: date('timeframe_end'),
    timeframeText: text('timeframe_text'),
    /** possibility | prediction */
    kind: text('kind').notNull().default('possibility'),
    factStatus: factStatus('fact_status').notNull().default('POSSIBILITY'),
    extractedFrom: uuid('extracted_from').references(() => extractions.id, {
      onDelete: 'set null',
    }),
    userEdited: boolean('user_edited').notNull().default(false),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('predictions_fact_status_check', sql`${t.factStatus} = 'POSSIBILITY'`),
    check('predictions_kind_check', sql`${t.kind} in ('possibility', 'prediction')`),
    uniqueIndex('predictions_reading_hash_idx').on(t.readingId, t.textHash),
    index('predictions_user_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('predictions_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('predictions_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid})`,
    }),
    pgPolicy('predictions_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: sql`${owned(t)} and exists (select 1 from ${readings} r where r.id = ${t.readingId} and r.user_id = ${authUid})`,
    }),
    pgPolicy('predictions_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Prediction = typeof predictions.$inferSelect;
