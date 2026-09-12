import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

/** Integration suite: runs against local Supabase, truncates platform tables between tests. */
export default defineConfig({
  resolve: { alias },
  // tsconfig says jsx: preserve (Next); component tests need the automatic runtime here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/__tests__/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
