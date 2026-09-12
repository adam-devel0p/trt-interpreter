/**
 * The narrow service-role surface. Add purpose-named functions here; do not re-export the raw
 * client to the rest of the tree.
 */
import { sql } from 'drizzle-orm';
import { adminDb, adminSql, adminSupabase, closeAdmin } from './client';

export { closeAdmin };

/** Health probe: is the database reachable? */
export async function pingDatabase(): Promise<boolean> {
  const rows = await adminSql()`select 1 as ok`;
  return rows[0]?.ok === 1;
}

/** Latest applied Drizzle migration tag, or null if the migrations table is absent. */
export async function latestAppliedMigration(): Promise<{
  hash: string;
  createdAt: number;
} | null> {
  try {
    const rows = await adminSql()<{ hash: string; created_at: string }[]>`
      select hash, created_at from drizzle.__drizzle_migrations
      order by created_at desc limit 1`;
    const row = rows[0];
    return row ? { hash: row.hash, createdAt: Number(row.created_at) } : null;
  } catch {
    return null;
  }
}

/** Drizzle handle for platform modules (jobs, flags). Still service-role: use with care. */
export function platformDb() {
  return adminDb();
}

/** Raw SQL for tests and scripts. */
export function platformSql() {
  return adminSql();
}

/** auth.admin surface: create/delete users (tests, account deletion). */
export function authAdmin() {
  return adminSupabase().auth.admin;
}

/** Test/seed helper: truncate the given public tables. Refuses to run in production. */
export async function truncateTables(tables: readonly string[]): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('truncateTables refused in production');
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t}"`).join(', ');
  await adminDb().execute(sql.raw(`truncate table ${list} restart identity cascade`));
}
