import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

/** Authorization suite: real database, real JWTs, two fixture users per file. */
export default defineConfig({
  resolve: { alias },
  test: {
    name: 'rls',
    environment: 'node',
    include: ['src/**/*.rls.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
