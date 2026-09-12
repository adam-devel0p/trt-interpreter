import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectNoUserAccess,
  type RlsFixture,
} from '@/__tests__/rls/harness';

describe('RLS: jobs (service-role only)', () => {
  let f: RlsFixture;
  beforeAll(async () => {
    f = await createRlsFixture();
    await platformSql()`insert into jobs (kind, payload, user_id) values ('noop_echo', '{}', ${f.a.id})`;
  });
  afterAll(async () => {
    await platformSql()`delete from jobs`;
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('is invisible and unwritable for authenticated users and anon, even for their own jobs', async () => {
    await expectNoUserAccess(f, 'jobs', { kind: 'noop_echo', payload: {}, user_id: f.a.id });
    const rows = await platformSql()`select count(*)::int as n from jobs`;
    expect(rows[0]?.n).toBe(1);
  });
});
