import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

describe('RLS: profiles', () => {
  let f: RlsFixture;
  beforeAll(async () => {
    f = await createRlsFixture();
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('exists for every new user, created by the auth.users trigger', async () => {
    const rows = await platformSql()<{ n: number }[]>`
      select count(*)::int as n from profiles where id = ${f.a.id}`;
    expect(rows[0]?.n).toBe(1);
  });

  it('isolates rows between users and hides them from anon (keyed by id)', async () => {
    await expectRlsIsolation(f, 'profiles', (userId) => ({ id: userId }), {
      ownerColumn: 'id',
      preexisting: true,
      mutableColumn: 'locale',
      mutatedValue: 'xx',
    });
  });

  it('does not let a user insert a profile for another id', async () => {
    const res = await f.b.client.from('profiles').insert({ id: randomUUID() });
    expect(res.error).not.toBeNull();
  });

  it('lets a user update own preferences but never own plan', async () => {
    const ok = await f.a.client
      .from('profiles')
      .update({ ai_explanation_depth: 'deep', use_reversals: false })
      .eq('id', f.a.id)
      .select('ai_explanation_depth, use_reversals')
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual({ ai_explanation_depth: 'deep', use_reversals: false });

    const denied = await f.a.client.from('profiles').update({ plan: 'pro' }).eq('id', f.a.id);
    expect(denied.error, 'plan must be read-only for users').not.toBeNull();
    expect(denied.error?.code).toBe('42501');
    const after = await f.a.client.from('profiles').select('plan').eq('id', f.a.id).single();
    expect(after.data?.plan).toBe('free');

    // The service role can change plan.
    await platformSql()`update profiles set plan = 'pro' where id = ${f.a.id}`;
    const now = await f.a.client.from('profiles').select('plan').eq('id', f.a.id).single();
    expect(now.data?.plan).toBe('pro');
  });
});
