import 'server-only';
/**
 * SERVICE-ROLE ACCESS. Bypasses RLS.
 *
 * Only files inside src/db/admin/ may import this module (eslint: local/layering). Everything
 * else imports the narrow, purpose-named functions exported from src/db/admin/index.ts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { clientEnv } from '@/config/env';
import { serverEnv } from '@/config/env.server';
import * as schema from '@/db/schema';

export type AdminDb = PostgresJsDatabase<typeof schema>;

let sqlSingleton: ReturnType<typeof postgres> | undefined;
let dbSingleton: AdminDb | undefined;
let supabaseSingleton: SupabaseClient | undefined;

/** Raw postgres-js connection (service credentials). */
export function adminSql(): ReturnType<typeof postgres> {
  sqlSingleton ??= postgres(serverEnv().DATABASE_URL, { max: 5, prepare: false });
  return sqlSingleton;
}

/** Drizzle over the service connection. */
export function adminDb(): AdminDb {
  dbSingleton ??= drizzle(adminSql(), { schema });
  return dbSingleton;
}

/** Supabase service-role client — needed for auth.admin (user creation in tests, deletion). */
export function adminSupabase(): SupabaseClient {
  supabaseSingleton ??= createClient(
    clientEnv().NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return supabaseSingleton;
}

/** Close pooled connections (scripts and test teardown). */
export async function closeAdmin(): Promise<void> {
  await sqlSingleton?.end({ timeout: 5 });
  sqlSingleton = undefined;
  dbSingleton = undefined;
}
