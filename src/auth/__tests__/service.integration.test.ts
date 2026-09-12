import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAnonClient } from '@/db/client';
import { authAdmin } from '@/db/admin';
import { AUTH_RATE_RULES, createRateLimiter } from '@/domain/auth/rateLimit';
import { createLogger, type LogLine } from '@/observability/logger';
import { AUTH_COPY } from '../copy';
import {
  requestPasswordReset,
  sendMagicLink,
  signInWithPassword,
  signUpWithPassword,
  type AuthContext,
} from '../service';

const created: string[] = [];
const lines: LogLine[] = [];

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    supabase: createAnonClient(),
    limiter: createRateLimiter(),
    ip: '203.0.113.7',
    origin: 'http://127.0.0.1:3100',
    log: createLogger((l) => lines.push(l)),
    ...overrides,
  };
}

const freshEmail = () => `svc-${randomUUID()}@test.local`;
async function knownEmail(): Promise<string> {
  const { data } = await authAdmin().getUserById(created[0]!);
  return data.user?.email ?? freshEmail();
}
const PASSWORD = 'correct-horse-battery';

afterAll(async () => {
  for (const id of created) await authAdmin().deleteUser(id);
});

describe('auth service', () => {
  it('signs up (local: no confirmation) and lands on onboarding; then signs in', async () => {
    const email = freshEmail();
    const c = ctx();
    const up = await signUpWithPassword(c, { email, password: PASSWORD });
    expect(up).toEqual({ kind: 'redirect', to: '/onboarding' });
    const { data } = await c.supabase.auth.getUser();
    created.push(data.user!.id);

    const inn = await signInWithPassword(ctx(), { email, password: PASSWORD, next: '/journal' });
    expect(inn).toEqual({ kind: 'redirect', to: '/journal' });
    const unsafe = await signInWithPassword(ctx(), { email, password: PASSWORD, next: '//evil' });
    expect(unsafe).toEqual({ kind: 'redirect', to: '/home' });
  });

  it('wrong password and unknown address produce the same generic message', async () => {
    const known = created.length ? await knownEmail() : freshEmail();
    const wrong = await signInWithPassword(ctx(), { email: known, password: 'wrong-password-1' });
    const unknown = await signInWithPassword(ctx(), {
      email: freshEmail(),
      password: 'wrong-password-1',
    });
    expect(wrong).toEqual({ kind: 'error', message: AUTH_COPY.signInFailed });
    expect(unknown).toEqual(wrong);
  });

  it('validates fields without touching the network', async () => {
    const c = ctx();
    const r = await signInWithPassword(c, { email: 'not-an-email', password: 'short' });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.fields).toEqual({
        email: AUTH_COPY.invalidEmail,
        password: AUTH_COPY.passwordTooShort,
      });
    }
  });

  it('trips the sign-in rate limit per email and per IP', async () => {
    const limiter = createRateLimiter();
    const email = freshEmail();
    let last;
    for (let i = 0; i <= AUTH_RATE_RULES.signInEmail.limit; i++) {
      last = await signInWithPassword(ctx({ limiter }), { email, password: 'wrong-password-1' });
    }
    expect(last).toEqual({ kind: 'error', message: AUTH_COPY.rateLimited });
    // A different address from the same IP is still fine until the IP bucket fills.
    const other = await signInWithPassword(ctx({ limiter }), {
      email: freshEmail(),
      password: 'wrong-password-1',
    });
    expect(other).toEqual({ kind: 'error', message: AUTH_COPY.signInFailed });
    for (let i = 0; i < AUTH_RATE_RULES.signInIp.limit; i++) {
      await signInWithPassword(ctx({ limiter }), {
        email: freshEmail(),
        password: 'wrong-password-1',
      });
    }
    const ipTripped = await signInWithPassword(ctx({ limiter }), {
      email: freshEmail(),
      password: 'wrong-password-1',
    });
    expect(ipTripped).toEqual({ kind: 'error', message: AUTH_COPY.rateLimited });
  });

  it('loopback skips per-IP buckets but per-email limits still apply', async () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < AUTH_RATE_RULES.signInIp.limit + 5; i++) {
      const r = await signInWithPassword(ctx({ limiter, ip: null }), {
        email: freshEmail(),
        password: 'wrong-password-1',
      });
      expect(r).toEqual({ kind: 'error', message: AUTH_COPY.signInFailed });
    }
    const email = freshEmail();
    let last;
    for (let i = 0; i <= AUTH_RATE_RULES.signInEmail.limit; i++) {
      last = await signInWithPassword(ctx({ limiter, ip: null }), {
        email,
        password: 'wrong-password-1',
      });
    }
    expect(last).toEqual({ kind: 'error', message: AUTH_COPY.rateLimited });
  });

  it('magic link and reset always answer "sent" and rate-limit per email', async () => {
    const limiter = createRateLimiter();
    const email = freshEmail();
    expect(await sendMagicLink(ctx({ limiter }), { email })).toEqual({
      kind: 'sent',
      message: AUTH_COPY.linkSent,
    });
    expect(await requestPasswordReset(ctx({ limiter }), { email })).toEqual({
      kind: 'sent',
      message: AUTH_COPY.linkSent,
    });
    let last;
    for (let i = 0; i <= AUTH_RATE_RULES.emailLinkEmail.limit; i++) {
      last = await requestPasswordReset(ctx({ limiter }), { email });
    }
    expect(last).toEqual({ kind: 'error', message: AUTH_COPY.rateLimited });
  });

  it('never logs an email address, a password, or any non-whitelisted key', () => {
    expect(lines.length).toBeGreaterThan(5);
    const allowed = new Set([
      'level',
      'event',
      'ts',
      'userId',
      'errorClass',
      'route',
      'status',
      'count',
      'requestId',
    ]);
    for (const line of lines) {
      for (const key of Object.keys(line))
        expect(allowed, `unexpected log key ${key}`).toContain(key);
      const text = JSON.stringify(line);
      expect(text).not.toMatch(/@test\.local/);
      expect(text).not.toContain(PASSWORD);
      expect(line.event.startsWith('auth.')).toBe(true);
    }
  });
});
