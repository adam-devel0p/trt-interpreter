import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';

/**
 * Retrieval and Ask My History (docs/DATA_MODEL.md#retrieval--summaries--phases-09-10,
 * spec §8, §6.6, FR-18, FR-19).
 *
 *   - a **retrieval document** is the compact, deterministic text built for an object
 *     (`domain/retrieval/document.ts`) — the only thing an embedding provider ever sees.
 *     One current row per object; `content_hash` stops redundant re-embedding;
 *   - an **embedding** is that document's vector, with the model that produced it, so a
 *     model change is a re-embedding job rather than a rewrite. Vectors die with their
 *     document (FK cascade) and the document dies with its object (`retrieval_documents_
 *     cascade` triggers on `readings` and `life_events`, plus the purge job's explicit step);
 *   - an **ask** is one question the user put to their history: the question (their words),
 *     the scope, the parsed hints, the verified answer with its citations as object ids, what
 *     the model saw and what the bound left out, provenance and the user's thumbs.
 *
 * Documents and embeddings are written by jobs (service role) and readable / deletable by
 * their owner. Vector similarity queries go through `search_history()` (SECURITY INVOKER,
 * additionally filtered by `auth.uid()`) — never the index alone.
 */

const owned = (t: { userId: AnyPgColumn }) => sql`${t.userId} = ${authUid}`;

export const retrievalDocuments = pgTable(
  'retrieval_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    /** The §8.3 template text. Never the user's notes. */
    text: text('text').notNull(),
    builderVersion: text('builder_version').notNull(),
    contentHash: text('content_hash').notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'retrieval_documents_object_type_check',
      sql`${t.objectType} in ('reading', 'life_event', 'period_summary')`,
    ),
    check('retrieval_documents_text_check', sql`length(${t.text}) between 1 and 2000`),
    uniqueIndex('retrieval_documents_object_idx').on(t.objectType, t.objectId),
    index('retrieval_documents_user_idx').on(t.userId, t.builtAt.desc()),
    pgPolicy('retrieval_documents_select', {
      for: 'select',
      to: authenticatedRole,
      using: owned(t),
    }),
    pgPolicy('retrieval_documents_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: owned(t),
    }),
  ],
).enableRLS();

export type RetrievalDocument = typeof retrievalDocuments.$inferSelect;

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    retrievalDocumentId: uuid('retrieval_document_id')
      .notNull()
      .references(() => retrievalDocuments.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    vector: vector('vector', { dimensions: 1536 }).notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    /** The document hash this vector was computed from; a mismatch means "re-embed". */
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'embeddings_object_type_check',
      sql`${t.objectType} in ('reading', 'life_event', 'period_summary')`,
    ),
    uniqueIndex('embeddings_document_idx').on(t.retrievalDocumentId),
    index('embeddings_user_object_idx').on(t.userId, t.objectType, t.objectId),
    index('embeddings_vector_idx').using('hnsw', t.vector.op('vector_cosine_ops')),
    pgPolicy('embeddings_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    pgPolicy('embeddings_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Embedding = typeof embeddings.$inferSelect;

export const asks = pgTable(
  'asks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** The user's question, exactly as typed. */
    question: text('question').notNull(),
    /** `{kind: 'all' | 'journey' | 'entity' | 'range', …}` (`domain/retrieval/query.ts`). */
    scope: jsonb('scope').notNull(),
    status: text('status').notNull().default('pending'),
    errorClass: text('error_class'),
    /** The `parse_history_query` output the pipeline used (or the empty fallback). */
    parsedQuery: jsonb('parsed_query'),
    /** The conclusion, shown first. */
    answer: text('answer'),
    /** `[{text, citations: [{object_type, object_id}]}]` after verification. */
    claims: jsonb('claims'),
    /** Every cited object once: `[{object_type, object_id}]`. */
    citations: jsonb('citations'),
    evidenceSufficient: boolean('evidence_sufficient'),
    found: text('found'),
    narrowerQuestion: text('narrower_question'),
    /** What the model saw / what the bound left out: `[{type, id}]`. */
    packageObjectIds: jsonb('package_object_ids'),
    droppedObjectIds: jsonb('dropped_object_ids'),
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    latencyMs: integer('latency_ms'),
    /** Thumbs: 1 up, -1 down, null none (§16). */
    feedback: smallint('feedback'),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('asks_status_check', sql`${t.status} in ('pending', 'complete', 'failed')`),
    check('asks_feedback_check', sql`${t.feedback} is null or ${t.feedback} in (-1, 1)`),
    check('asks_question_check', sql`length(${t.question}) between 1 and 400`),
    index('asks_user_created_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('asks_select', { for: 'select', to: authenticatedRole, using: owned(t) }),
    // A session records the question; the answer is written by the pipeline (service role).
    pgPolicy('asks_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${owned(t)} and ${t.status} = 'pending' and ${t.answer} is null and ${t.claims} is null`,
    }),
    pgPolicy('asks_update', {
      for: 'update',
      to: authenticatedRole,
      using: owned(t),
      withCheck: owned(t),
    }),
    pgPolicy('asks_delete', { for: 'delete', to: authenticatedRole, using: owned(t) }),
  ],
).enableRLS();

export type Ask = typeof asks.$inferSelect;
