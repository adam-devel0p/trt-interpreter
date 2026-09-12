import 'server-only';
import { headers } from 'next/headers';
import { createRateLimiter, type RateLimiter } from '@/domain/auth/rateLimit';

/**
 * Process-wide limiter instance. In-memory: per server instance, reset on deploy. Supabase Auth
 * applies its own limits behind it; a shared store is a Phase 12 hardening item.
 */
const globalKey = Symbol.for('tarot-journal.auth-limiter');
type G = typeof globalThis & { [globalKey]?: RateLimiter };

export function authLimiter(): RateLimiter {
  const g = globalThis as G;
  g[globalKey] ??= createRateLimiter();
  return g[globalKey];
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Best-effort client IP from proxy headers, or `null` for loopback. Production traffic always
 * arrives through a proxy that sets `x-forwarded-for`, so loopback only ever means a local
 * developer or the e2e suite — and per-IP buckets would otherwise fill up across repeated
 * runs against one long-lived server. Per-email limits apply regardless.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  return LOOPBACK.has(first) ? null : first;
}
