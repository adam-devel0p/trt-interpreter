import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import local from './eslint/local-rules.mjs';

// Patterns are gitignore-style: '/ai' anchors to the bare package name so '@/ai' stays allowed.
const PROVIDER_SDKS = ['@anthropic-ai/*', '/openai', '@ai-sdk/*', '/ai', '@google/*', '/cohere-ai'];
const NO_PROVIDER_SDKS = [
  { group: PROVIDER_SDKS, message: 'Model provider SDKs may only be imported inside src/ai/.' },
];
const NO_ADMIN_CLIENT = [
  {
    group: ['@/db/admin/client', '**/db/admin/client'],
    message: 'Import the narrow surface from @/db/admin instead.',
  },
];
const NO_ADMIN_CLIENT_OUTSIDE_ADMIN = NO_ADMIN_CLIENT;
const NO_RAW_DB = [
  {
    group: ['/postgres', 'drizzle-orm/postgres-js', 'drizzle-orm/node-postgres'],
    message: 'Direct database connections only in src/db/admin/.',
  },
];
const NO_DB_FROM_AI = [
  {
    group: ['@/db', '@/db/*', '**/db/**'],
    message: 'ai/ touches the database only through telemetry.ts.',
  },
];
/** Phase 11: the single feature check. Only the gate module and the AI budget hook read it. */
const NO_ENTITLEMENTS_OUTSIDE_BILLING = [
  {
    group: ['@/domain/billing/entitlements', '**/domain/billing/entitlements'],
    message:
      'Feature checks go through src/billing/gate.ts (loadEntitlements / checkFeatureFor); nothing else decides what a plan allows.',
  },
];
const DOMAIN_PURITY = [
  { group: ['@/db', '@/db/*', '**/db/**'], message: 'domain/ may not import db/.' },
  { group: ['@/ai', '@/ai/*', '**/ai/**'], message: 'domain/ may not import ai/.' },
  { group: ['@/jobs', '@/jobs/*'], message: 'domain/ may not import jobs/.' },
  { group: ['@/flags', '@/flags/*'], message: 'domain/ may not import flags/.' },
  {
    group: ['/next', 'next/*', '/react', 'react/*', '/react-dom'],
    message: 'domain/ is framework-free.',
  },
  { group: ['/drizzle-orm', 'drizzle-orm/*', '@supabase/*'], message: 'domain/ performs no I/O.' },
];

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/** Provider SDKs that only src/ai/ may import. */

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'public/sw.js',
      'next-env.d.ts',
      'src/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...compat.extends('next/core-web-vitals'),
  {
    plugins: { local },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'local/no-server-env-in-client': 'error',
    },
  },

  // ── Layering rules. `no-restricted-imports` options do not merge across flat-config blocks,
  //    so each layer gets one composed pattern set and blocks are ordered most-specific last. ──
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...NO_PROVIDER_SDKS,
            ...NO_ADMIN_CLIENT,
            ...NO_RAW_DB,
            ...NO_ENTITLEMENTS_OUTSIDE_BILLING,
          ],
        },
      ],
    },
  },
  // The gate and its neighbours are the one place a plan becomes a verdict.
  {
    files: ['src/billing/**', 'src/ai/telemetry.ts', 'src/domain/billing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_PROVIDER_SDKS, ...NO_ADMIN_CLIENT, ...NO_RAW_DB] },
      ],
    },
  },
  // The migrator, drizzle config, schema, admin/, and tests may open raw connections.
  {
    files: [
      'src/db/admin/**',
      'scripts/db-migrate.ts',
      'drizzle.config.ts',
      'src/db/schema/**',
      'src/__tests__/**',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_PROVIDER_SDKS, ...NO_ADMIN_CLIENT_OUTSIDE_ADMIN] },
      ],
    },
  },
  {
    files: ['src/db/admin/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_PROVIDER_SDKS, ...NO_ENTITLEMENTS_OUTSIDE_BILLING] },
      ],
    },
  },
  // src/ai/: provider SDKs allowed (only here); the database only through telemetry.ts.
  {
    files: ['src/ai/**/*.ts'],
    ignores: ['src/ai/telemetry.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...NO_ADMIN_CLIENT,
            ...NO_RAW_DB,
            ...NO_DB_FROM_AI,
            ...NO_ENTITLEMENTS_OUTSIDE_BILLING,
          ],
        },
      ],
    },
  },
  // src/domain/: pure TS. No db, ai, jobs, flags, framework, I/O or provider imports.
  {
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/billing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...NO_PROVIDER_SDKS,
            ...NO_ADMIN_CLIENT,
            ...NO_RAW_DB,
            ...DOMAIN_PURITY,
            ...NO_ENTITLEMENTS_OUTSIDE_BILLING,
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/billing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...NO_PROVIDER_SDKS, ...NO_ADMIN_CLIENT, ...NO_RAW_DB, ...DOMAIN_PURITY] },
      ],
    },
  },

  // ── Design-system rule: no hard-coded colours in UI code. ──
  {
    files: ['src/ui/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    // theme-colors.ts is the one sanctioned literal source (manifest / <meta theme-color> cannot read CSS).
    ignores: ['src/ui/theme-colors.ts'],
    rules: { 'local/no-hardcoded-colors': 'error' },
  },

  // Scripts and config may use console and node globals freely.
  {
    files: ['scripts/**/*.ts', '*.config.ts', '*.config.mjs', 'eslint/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
