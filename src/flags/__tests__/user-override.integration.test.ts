import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformSql } from '@/db/admin';
import { flag } from '@/flags';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

describe('flags: user_flags overrides', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await createTestUser('flags');
  });
  afterAll(async () => {
    await deleteTestUser(user);
  });

  it('env default applies when no override exists', async () => {
    expect(await flag('ai_extraction', { userId: user.id })).toBe(false);
  });

  it('a user_flags row overrides the env default for that user only', async () => {
    await platformSql()`
      insert into user_flags (user_id, flag, enabled, set_by)
      values (${user.id}, 'ai_extraction', true, 'rollout')`;
    expect(await flag('ai_extraction', { userId: user.id })).toBe(true);
    expect(await flag('ai_extraction', { userId: '00000000-0000-0000-0000-000000000000' })).toBe(
      false,
    );
    expect(await flag('entity_resolution', { userId: user.id })).toBe(false);
  });
});
