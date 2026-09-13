import 'server-only';
import { cookies } from 'next/headers';
import { serverEnv } from '@/config/env.server';
import { envKeyFor, FLAGS, type FlagName } from './flags';
import { DEV_FLAGS_COOKIE, parseSessionOverrides, resolveFlag } from './resolve';
import { readUserOverride } from './server';

export { FLAGS, type FlagName } from './flags';
export { flagForUser } from './server';

/**
 * Server-side flag lookup. Resolution: env default → `user_flags` override (table lands in
 * Phase 01; a missing table is tolerated) → dev-only session cookie set from /dev/flags.
 */
export async function flag(name: FlagName, ctx: { userId?: string } = {}): Promise<boolean> {
  const env = serverEnv();
  const envDefault = env[envKeyFor(name)];
  const [userOverride, sessionOverride] = await Promise.all([
    ctx.userId ? readUserOverride(ctx.userId, name) : Promise.resolve(undefined),
    readSessionOverride(name),
  ]);
  return resolveFlag({
    envDefault,
    userOverride,
    sessionOverride,
    allowSessionOverride: env.NODE_ENV !== 'production',
  });
}

/** All flags at once, for the dev page and for passing a snapshot to the client. */
export async function allFlags(ctx: { userId?: string } = {}): Promise<Record<FlagName, boolean>> {
  const entries = await Promise.all(FLAGS.map(async (f) => [f, await flag(f, ctx)] as const));
  return Object.fromEntries(entries) as Record<FlagName, boolean>;
}

async function readSessionOverride(name: FlagName): Promise<boolean | undefined> {
  try {
    const store = await cookies();
    return parseSessionOverrides(store.get(DEV_FLAGS_COOKIE)?.value)[name];
  } catch {
    // Outside a request scope (scripts, jobs) there is no session.
    return undefined;
  }
}
