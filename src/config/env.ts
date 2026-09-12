/**
 * Client-safe environment. Only NEXT_PUBLIC_* variables live here, so this module may be
 * imported from anywhere, including 'use client' files.
 *
 * Server-only variables live in ./env.server.ts. Importing that from client code is a lint
 * error (see eslint.config.mjs → local/no-server-env-in-client) and a Next build error
 * (it imports 'server-only').
 *
 * Every variable is listed explicitly (not `process.env` spread) because Next.js inlines
 * NEXT_PUBLIC_* values by static reference only.
 */
import { z } from 'zod';

const clientSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'preview', 'production', 'test']),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  /** Canonical origin for public reference pages (metadata, JSON-LD). Defaults to localhost. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

export function parseClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const result = clientSchema.safeParse(raw);
  if (!result.success) {
    // Loud, specific, and content-free: variable names only, never values.
    const missing = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid client environment:\n  ${missing.join('\n  ')}`);
  }
  return result.data;
}

let cached: ClientEnv | undefined;

/** Validated public env. Parsed once, on first access, so tests can stub process.env first. */
export function clientEnv(): ClientEnv {
  cached ??= parseClientEnv({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV ?? 'development',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  });
  return cached;
}
