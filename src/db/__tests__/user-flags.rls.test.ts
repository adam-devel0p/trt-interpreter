import { afterAll, beforeAll, describe, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectReadOwnOnly,
  type RlsFixture,
} from '@/__tests__/rls/harness';

describe('RLS: user_flags (read own, service-role writes)', () => {
  let f: RlsFixture;
  beforeAll(async () => {
    f = await createRlsFixture();
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('lets a user read only own overrides and never write any', async () => {
    await expectReadOwnOnly(
      f,
      'user_flags',
      (userId) => ({ user_id: userId, flag: 'ai_extraction', enabled: true }),
      async (row) => {
        const rows = await platformSql()<{ id: string }[]>`
          insert into user_flags (user_id, flag, enabled)
          values (${row.user_id as string}, ${row.flag as string}, ${row.enabled as boolean})
          returning id`;
        return { id: rows[0]!.id };
      },
      { mutableColumn: 'enabled', mutatedValue: false },
    );
  });
});
