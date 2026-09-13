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

export interface IsolationOptions {
  /** The column B attempts to overwrite. */
  mutableColumn: string;
  mutatedValue: unknown;
  /** Column holding the owner's auth.uid(). Default `user_id`; `profiles` is keyed by `id`. */
  ownerColumn?: string;
  /** Primary-key column. Default `id`; `reading_drafts` is keyed by `user_id`. */
  idColumn?: string;
  /**
   * The row already exists for A (created by a trigger, e.g. `profiles`). The harness then reads
   * it instead of inserting, skips the spoofed insert (a PK conflict would mask the RLS check) and
   * asserts that A *cannot* delete it (no delete policy: account deletion is service-role only).
   */
  preexisting?: boolean;
  /**
   * The table also holds public rows (built-in `spreads`), so anon legitimately reads *some*
   * rows; the assertion becomes "anon cannot see A's row" instead of "anon reads nothing".
   */
  hasPublicRows?: boolean;
}

/**
 * Full isolation assertion for one table:
 *   - A can insert (or already owns) and read own row; B and anon see nothing.
 *   - B cannot insert a row claiming A's ownership.
 *   - B cannot update or delete A's row (0 rows affected, row unchanged).
 *   - A can delete own row (or, for preexisting rows, cannot).
 */
export async function expectRlsIsolation(
  f: RlsFixture,
  table: string,
  rowFactory: RowFactory,
  opts: IsolationOptions,
): Promise<void> {
  const owner = opts.ownerColumn ?? 'user_id';
  const pk = opts.idColumn ?? 'id';
  let rowA: Record<string, unknown>;
  let id: string;
  if (opts.preexisting) {
    const existing = await f.a.client.from(table).select('*').eq(owner, f.a.id).single();
    expect(existing.error, `A must already own a ${table} row`).toBeNull();
    rowA = existing.data as Record<string, unknown>;
    id = rowA[pk] as string;
  } else {
    rowA = rowFactory(f.a.id);
    const ins = await f.a.client.from(table).insert(rowA).select('*').single();
    expect(ins.error, `A insert into ${table}`).toBeNull();
    id = (ins.data as Record<string, string>)[pk]!;
  }

  const ownRead = await f.a.client.from(table).select(pk).eq(pk, id);
  expect(ownRead.data).toHaveLength(1);

  const bRead = await f.b.client.from(table).select(pk).eq(pk, id);
  expect(bRead.error).toBeNull();
  expect(bRead.data, `B must not read A's ${table} row`).toHaveLength(0);

  if (opts.hasPublicRows) {
    const anonRow = await f.anon.from(table).select(pk).eq(pk, id);
    expect(anonRow.data ?? [], `anon must not read A's ${table} row`).toHaveLength(0);
  } else {
    const anonRead = await f.anon.from(table).select(pk);
    expect(anonRead.data ?? [], `anon must read nothing from ${table}`).toHaveLength(0);
  }

  if (!opts.preexisting) {
    const bSpoof = await f.b.client.from(table).insert(rowFactory(f.a.id));
    expect(bSpoof.error, `B must not insert a row owned by A in ${table}`).not.toBeNull();
  }

  const bUpdate = await f.b.client
    .from(table)
    .update({ [opts.mutableColumn]: opts.mutatedValue })
    .eq(pk, id)
    .select(pk);
  expect(bUpdate.data ?? []).toHaveLength(0);
  const afterUpdate = await f.a.client.from(table).select(opts.mutableColumn).eq(pk, id).single();
  expect((afterUpdate.data as unknown as Record<string, unknown>)[opts.mutableColumn]).toEqual(
    rowA[opts.mutableColumn],
  );

  const bDelete = await f.b.client.from(table).delete().eq(pk, id).select(pk);
  expect(bDelete.data ?? []).toHaveLength(0);
  const stillThere = await f.a.client.from(table).select(pk).eq(pk, id);
  expect(stillThere.data).toHaveLength(1);

  const aDelete = await f.a.client.from(table).delete().eq(pk, id).select(pk);
  if (opts.preexisting) {
    expect(aDelete.data ?? [], `A must not delete own ${table} row`).toHaveLength(0);
  } else {
    expect(aDelete.data).toHaveLength(1);
  }
}

/**
 * For tables users may read but only the service role writes (e.g. `user_flags`): rows are
 * seeded through `seed`, then A sees only own rows, B and anon see none of A's, and A cannot
 * insert, update or delete even own rows.
 */
export async function expectReadOwnOnly(
  f: RlsFixture,
  table: string,
  rowFactory: RowFactory,
  seed: (row: Record<string, unknown>) => Promise<{ id: string }>,
  opts: { mutableColumn: string; mutatedValue: unknown },
): Promise<void> {
  const rowA = rowFactory(f.a.id);
  const { id } = await seed(rowA);

  const ownRead = await f.a.client.from(table).select('id').eq('id', id);
  expect(ownRead.error).toBeNull();
  expect(ownRead.data, `A must read own ${table} row`).toHaveLength(1);

  const bRead = await f.b.client.from(table).select('id').eq('id', id);
  expect(bRead.data ?? [], `B must not read A's ${table} row`).toHaveLength(0);
  const anonRead = await f.anon.from(table).select('id');
  expect(anonRead.data ?? [], `anon must read nothing from ${table}`).toHaveLength(0);

  const aInsert = await f.a.client.from(table).insert(rowFactory(f.a.id)).select('id');
  expect(aInsert.error, `A must not insert into ${table}`).not.toBeNull();

  const aUpdate = await f.a.client
    .from(table)
    .update({ [opts.mutableColumn]: opts.mutatedValue })
    .eq('id', id)
    .select('id');
  expect(aUpdate.data ?? [], `A must not update ${table}`).toHaveLength(0);
  const after = await f.a.client.from(table).select(opts.mutableColumn).eq('id', id).single();
  expect((after.data as unknown as Record<string, unknown>)[opts.mutableColumn]).toEqual(
    rowA[opts.mutableColumn],
  );

  const aDelete = await f.a.client.from(table).delete().eq('id', id).select('id');
  expect(aDelete.data ?? [], `A must not delete from ${table}`).toHaveLength(0);
  const stillThere = await f.a.client.from(table).select('id').eq('id', id);
  expect(stillThere.data).toHaveLength(1);
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

/**
 * For global reference tables (`decks`, `cards`, …): anon and authenticated users can read
 * every row; neither can insert, update or delete anything. `sampleRow` is what a user would
 * try to insert; `mutableColumn` is what they would try to change on an existing row.
 */
export async function expectPublicReadOnly(
  f: RlsFixture,
  table: string,
  sampleRow: Record<string, unknown>,
  opts: { mutableColumn: string; mutatedValue: unknown },
): Promise<void> {
  for (const [who, client] of [
    ['A', f.a.client],
    ['anon', f.anon],
  ] as const) {
    const read = await client.from(table).select('id').limit(5);
    expect(read.error, `${who} read ${table}`).toBeNull();
    expect(read.data?.length ?? 0, `${who} must read ${table}`).toBeGreaterThan(0);
    const id = (read.data![0] as { id: string }).id;

    const ins = await client.from(table).insert(sampleRow).select('id');
    expect(
      ins.error ?? ins.data?.length === 0,
      `${who} must not insert into ${table}`,
    ).toBeTruthy();
    expect(ins.data ?? []).toHaveLength(0);

    const before = await client.from(table).select(opts.mutableColumn).eq('id', id).single();
    const upd = await client
      .from(table)
      .update({ [opts.mutableColumn]: opts.mutatedValue })
      .eq('id', id)
      .select('id');
    expect(upd.data ?? [], `${who} must not update ${table}`).toHaveLength(0);
    const after = await client.from(table).select(opts.mutableColumn).eq('id', id).single();
    expect(after.data).toEqual(before.data);

    const del = await client.from(table).delete().eq('id', id).select('id');
    expect(del.data ?? [], `${who} must not delete from ${table}`).toHaveLength(0);
    const still = await client.from(table).select('id').eq('id', id);
    expect(still.data).toHaveLength(1);
  }
}
