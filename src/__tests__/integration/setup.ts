import { afterAll, beforeEach } from 'vitest';
import { closeAdmin, truncateTables } from '@/db/admin';

/** Platform tables truncated between tests. Extend as phases add tables. */
export const PLATFORM_TABLES = ['jobs', 'ai_calls'] as const;

beforeEach(async () => {
  await truncateTables(PLATFORM_TABLES);
});

afterAll(async () => {
  await closeAdmin();
});
