import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

/** Unit suite: pure logic, no database, no network. */
export default defineConfig({
  resolve: { alias },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/*.integration.test.ts', '**/*.rls.test.ts', 'node_modules', '.next'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts'] },
  },
});
