import { afterAll, beforeAll, describe, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

describe('RLS: reminder_settings', () => {
  let f: RlsFixture;
  beforeAll(async () => {
    f = await createRlsFixture();
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('isolates rows between users and hides them from anon', async () => {
    await expectRlsIsolation(
      f,
      'reminder_settings',
      (userId) => ({ user_id: userId, weekly_reflection: true }),
      { mutableColumn: 'weekly_reflection', mutatedValue: false },
    );
  });
});
