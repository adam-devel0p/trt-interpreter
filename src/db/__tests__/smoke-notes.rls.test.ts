import { afterAll, beforeAll, describe, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

// THROWAWAY (Phase 00): proves the harness. Phase 01 replaces this with profiles.
describe('RLS: smoke_notes', () => {
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
      'smoke_notes',
      (userId) => ({ user_id: userId, body: 'note for rls' }),
      { mutableColumn: 'body', mutatedValue: 'overwritten by B' },
    );
  });
});
