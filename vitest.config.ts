import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

/** Unit suite: pure logic, no database, no network. */
export default defineConfig({
  resolve: { alias },
  // tsconfig says jsx: preserve (Next); component tests need the automatic runtime here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/*.integration.test.ts', '**/*.rls.test.ts', 'node_modules', '.next'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts'] },
  },
});
