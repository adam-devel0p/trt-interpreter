import 'server-only';
/**
 * Server-only environment. Never import from a 'use client' file — the lint rule
 * `local/no-server-env-in-client` and the 'server-only' import both enforce this.
 *
 * Missing or malformed variables throw on first access with the variable *names*
 * (never values) so misconfiguration is loud at startup rather than a silent undefined.
 */
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  JOBS_RUN_SECRET: z.string().min(16),
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),

  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().min(1).default('claude-haiku-4-5'),
  AI_MODEL_STANDARD: z.string().min(1).default('claude-sonnet-5'),
  AI_MODEL_DEEP: z.string().min(1).default('claude-opus-5'),
  AI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),

  FLAG_AI_EXTRACTION: bool,
  FLAG_ENTITY_RESOLUTION: bool,
  FLAG_JOURNEY_AUTOCREATE: bool,
  FLAG_CORRELATION_SUGGESTIONS: bool,
  FLAG_ASK_MY_HISTORY: bool,
  FLAG_PERIOD_SUMMARIES: bool,
  FLAG_SHARE_CARDS: bool,
  FLAG_PHYSICAL_PHOTO_OCR: bool,
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server environment:\n  ${issues.join('\n  ')}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Validated server env. Parsed once on first access. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Test-only: drop the cache so a test can re-parse with stubbed process.env. */
export function resetServerEnvForTests(): void {
  cached = undefined;
}
