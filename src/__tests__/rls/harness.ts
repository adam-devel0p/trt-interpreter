/**
 * RLS test harness (docs/TESTING.md). Creates two real users with real JWTs via the auth admin
 * API, then asserts that user B and anon cannot read, write, update or delete user A's rows.
 * Reusable for every user-owned table added in later phases.
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAnonClient, createTokenUserClient } from '@/db/client';
import { authAdmin } from '@/db/admin';
import { clientEnv } from '@/config/env';
import { createClient } from '@supabase/supabase-js';

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await authAdmin().createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const env = clientEnv();
  const signIn = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await signIn.auth.signInWithPassword({ email, password });
  const token = session.data.session?.access_token;
  if (!token) throw new Error(`signIn failed: ${session.error?.message}`);
  return { id: data.user.id, email, client: createTokenUserClient(token) };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await authAdmin().deleteUser(user.id);
}

export interface RlsFixture {
  a: TestUser;
  b: TestUser;
  anon: SupabaseClient;
}

export async function createRlsFixture(): Promise<RlsFixture> {
  const [a, b] = await Promise.all([createTestUser('a'), createTestUser('b')]);
  return { a, b, anon: createAnonClient() };
}

export async function destroyRlsFixture(f: RlsFixture): Promise<void> {
  await Promise.all([deleteTestUser(f.a), deleteTestUser(f.b)]);
}

export type RowFactory = (userId: string) => Record<string, unknown>;

/**
 * Full isolation assertion for one table:
 *   - A can insert and read own row; B and anon see nothing.
 *   - B cannot insert a row claiming A's user_id.
 *   - B cannot update or delete A's row (0 rows affected, row unchanged).
 *   - A can delete own row.
 * `mutableColumn` is the column B attempts to overwrite.
 */
export async function expectRlsIsolation(
  f: RlsFixture,
  table: string,
  rowFactory: RowFactory,
  opts: { mutableColumn: string; mutatedValue: unknown },
): Promise<void> {
  const rowA = rowFactory(f.a.id);
  const ins = await f.a.client.from(table).insert(rowA).select('*').single();
  expect(ins.error, `A insert into ${table}`).toBeNull();
  const id = (ins.data as { id: string }).id;

  const ownRead = await f.a.client.from(table).select('id').eq('id', id);
  expect(ownRead.data).toHaveLength(1);

  const bRead = await f.b.client.from(table).select('id').eq('id', id);
  expect(bRead.error).toBeNull();
  expect(bRead.data, `B must not read A's ${table} row`).toHaveLength(0);

  const anonRead = await f.anon.from(table).select('id');
  expect(anonRead.data ?? [], `anon must read nothing from ${table}`).toHaveLength(0);

  const bSpoof = await f.b.client.from(table).insert(rowFactory(f.a.id));
  expect(bSpoof.error, `B must not insert a row owned by A in ${table}`).not.toBeNull();

  const bUpdate = await f.b.client
    .from(table)
    .update({ [opts.mutableColumn]: opts.mutatedValue })
    .eq('id', id)
    .select('id');
  expect(bUpdate.data ?? []).toHaveLength(0);
  const afterUpdate = await f.a.client.from(table).select(opts.mutableColumn).eq('id', id).single();
  expect((afterUpdate.data as unknown as Record<string, unknown>)[opts.mutableColumn]).toEqual(
    rowA[opts.mutableColumn],
  );

  const bDelete = await f.b.client.from(table).delete().eq('id', id).select('id');
  expect(bDelete.data ?? []).toHaveLength(0);
  const stillThere = await f.a.client.from(table).select('id').eq('id', id);
  expect(stillThere.data).toHaveLength(1);

  const aDelete = await f.a.client.from(table).delete().eq('id', id).select('id');
  expect(aDelete.data).toHaveLength(1);
}

/** For service-role-only tables: authenticated users and anon can neither read nor write. */
export async function expectNoUserAccess(
  f: RlsFixture,
  table: string,
  row: Record<string, unknown>,
) {
  for (const [who, client] of [
    ['A', f.a.client],
    ['anon', f.anon],
  ] as const) {
    const read = await client.from(table).select('id');
    expect(read.data ?? [], `${who} must not read ${table}`).toHaveLength(0);
    const write = await client.from(table).insert(row).select('id');
    expect(write.error ?? write.data?.length === 0, `${who} must not write ${table}`).toBeTruthy();
    expect(write.data ?? []).toHaveLength(0);
  }
}
