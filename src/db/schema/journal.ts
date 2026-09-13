import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { readings } from './readings';

/**
 * Journal, deletion and export tables (docs/DATA_MODEL.md, Phase 05).
 */

/**
 * Every previous value of a reading's own-words columns (invariant 4: raw user text is never
 * discarded or overwritten). Written **only** by the `readings_keep_note_revisions` trigger
 * (SECURITY DEFINER) whenever `user_notes` or `question` changes, so the history exists
 * whichever code path did the edit. Users may read and, through the reading, cascade-delete
 * their own revisions; there is no insert or update policy — nothing but the trigger writes.
 */
export const readingNoteRevisions = pgTable(
  'reading_note_revisions',
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
    /** Which column the text came from. */
    field: text('field').notNull(),
    /** The text as it was before the edit that replaced it. The user's own words, verbatim. */
    content: text('content').notNull(),
    /** `readings.metadata_version` at the time of the edit. */
    metadataVersion: integer('metadata_version').notNull(),
    replacedAt: timestamp('replaced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reading_note_revisions_field_check', sql`${t.field} in ('user_notes', 'question')`),
    index('reading_note_revisions_reading_idx').on(t.readingId, t.replacedAt.desc()),
    index('reading_note_revisions_user_idx').on(t.userId, t.replacedAt.desc()),
    pgPolicy('reading_note_revisions_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('reading_note_revisions_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type ReadingNoteRevision = typeof readingNoteRevisions.$inferSelect;

/**
 * What a purge removed, by table (§19, FR-23). Written by the service role from the purge
 * job and the "delete AI artifacts" action; readable by the owner. `user_id` is nulled rather
 * than cascaded so an account deletion's receipt (Phase 12) can outlive the account — a receipt
 * holds counts and IDs, never content.
 */
export const deletionReceipts = pgTable(
  'deletion_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    /** reading | ai_artifacts | history | account */
    scope: text('scope').notNull(),
    objectType: text('object_type'),
    objectId: uuid('object_id'),
    jobId: uuid('job_id'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    /** { "<table>": <rows removed>, ... } — every table in the registry for the scope. */
    counts: jsonb('counts')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    check(
      'deletion_receipts_scope_check',
      sql`${t.scope} in ('reading', 'ai_artifacts', 'history', 'account')`,
    ),
    index('deletion_receipts_user_idx').on(t.userId, t.completedAt.desc()),
    pgPolicy('deletion_receipts_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type DeletionReceipt = typeof deletionReceipts.$inferSelect;

/**
 * Export requests (FR-22). The owner inserts a `queued` row (the request) and reads their
 * history; only the `export_user_data` job (service role) moves it on and attaches the archive.
 * The archive lives in the private `exports` storage bucket under `<user_id>/<id>.zip` and is
 * only ever handed out through a short-lived signed URL. Available on every plan (invariant 11).
 */
export const exports_ = pgTable(
  'exports',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** queued | running | ready | failed | expired */
    status: text('status').notNull().default('queued'),
    format: text('format').notNull().default('json_v1'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    storagePath: text('storage_path'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Row counts per file, mirrored from the manifest. */
    counts: jsonb('counts'),
    errorClass: text('error_class'),
    jobId: uuid('job_id'),
  },
  (t) => [
    check(
      'exports_status_check',
      sql`${t.status} in ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    check('exports_format_check', sql`${t.format} in ('json_v1')`),
    index('exports_user_idx').on(t.userId, t.requestedAt.desc()),
    pgPolicy('exports_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    // A request: the owner's own id, queued, nothing attached. Everything else is the job's.
    pgPolicy('exports_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid} and ${t.status} = 'queued' and ${t.storagePath} is null and ${t.jobId} is null`,
    }),
  ],
).enableRLS();

export type ExportRow = typeof exports_.$inferSelect;
