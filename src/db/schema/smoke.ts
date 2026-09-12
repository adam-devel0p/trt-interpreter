import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUid, authenticatedRole, authUsers } from 'drizzle-orm/supabase';

/**
 * THROWAWAY. Exists only to prove the RLS harness in Phase 00. Phase 01 drops this table and
 * moves the harness onto `profiles`. Do not build on it.
 */
export const smokeNotes = pgTable(
  'smoke_notes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('smoke_notes_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('smoke_notes_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('smoke_notes_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy('smoke_notes_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();
