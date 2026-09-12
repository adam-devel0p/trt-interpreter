import { describe, expect, it } from 'vitest';
import { parseClientEnv } from '../env';
import { parseServerEnv } from '../env.server';

describe('env validation', () => {
  it('fails loudly, naming the variable but not its value', () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_APP_ENV: 'development' })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() =>
      parseServerEnv({
        DATABASE_URL: 'not-a-url',
        SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(20),
        JOBS_RUN_SECRET: 'short',
      }),
    ).toThrow(/DATABASE_URL[\s\S]*JOBS_RUN_SECRET/);
  });

  it('parses flag booleans and model defaults', () => {
    const env = parseServerEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(20),
      JOBS_RUN_SECRET: 's'.repeat(20),
      FLAG_AI_EXTRACTION: 'true',
    });
    expect(env.FLAG_AI_EXTRACTION).toBe(true);
    expect(env.FLAG_SHARE_CARDS).toBe(false);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.AI_MODEL_DEEP).toBe('claude-opus-5');
  });
});
