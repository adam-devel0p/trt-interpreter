import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { jobStatus } from './enums';

/**
 * Platform job queue (docs/DATA_MODEL.md#platform-tables). Service-role only: RLS is enabled
 * with no policies, so anon/authenticated roles see nothing. Payloads carry object IDs, never
 * journal content.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastErrorClass: text('last_error_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAfter), index('jobs_user_idx').on(t.userId)],
).enableRLS();

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
