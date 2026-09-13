import 'server-only';
import { serverEnv } from '@/config/env.server';
import { platformSql } from '@/db/admin';
import { logger } from '@/observability/logger';
import { envKeyFor, type FlagName } from './flags';
import { resolveFlag } from './resolve';

/**
 * Flag lookup without a request: env default → `user_flags` override. For jobs and scripts,
 * where there is no session cookie to consult. `src/flags/index.ts` adds the dev-session layer
 * on top for request-scoped code.
 */
export async function flagForUser(name: FlagName, userId: string | null): Promise<boolean> {
  const env = serverEnv();
  return resolveFlag({
    envDefault: env[envKeyFor(name)],
    userOverride: userId ? await readUserOverride(userId, name) : undefined,
    sessionOverride: undefined,
    allowSessionOverride: false,
  });
}

export async function readUserOverride(
  userId: string,
  name: FlagName,
): Promise<boolean | undefined> {
  try {
    const rows = await platformSql()<{ enabled: boolean }[]>`
      select enabled from public.user_flags where user_id = ${userId} and flag = ${name} limit 1`;
    return rows[0]?.enabled;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== '42P01') logger.warn('flags.user_override_failed', { flag: name });
    return undefined;
  }
}
