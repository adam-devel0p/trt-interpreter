import { describe, expect, it } from 'vitest';
import { AUTH_RATE_RULES, createRateLimiter } from '../rateLimit';

const rule = { limit: 3, windowMs: 1000 };

describe('rate limiter', () => {
  it('allows up to the limit, then trips with a retry-after', () => {
    const l = createRateLimiter();
    expect(l.hit('k', rule, 0)).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    expect(l.hit('k', rule, 100)).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(l.hit('k', rule, 200)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(l.hit('k', rule, 300)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 700 });
    // Denied hits are not recorded, so the window does not extend under attack.
    expect(l.peek('k', rule, 300).allowed).toBe(false);
  });

  it('slides: the oldest hit expiring frees one slot', () => {
    const l = createRateLimiter();
    l.hit('k', rule, 0);
    l.hit('k', rule, 100);
    l.hit('k', rule, 200);
    expect(l.hit('k', rule, 999).allowed).toBe(false);
    expect(l.hit('k', rule, 1001).allowed).toBe(true);
    expect(l.hit('k', rule, 1002).allowed).toBe(false);
  });

  it('keys are independent and resettable', () => {
    const l = createRateLimiter();
    for (let i = 0; i < 3; i++) l.hit('a', rule, i);
    expect(l.hit('a', rule, 10).allowed).toBe(false);
    expect(l.hit('b', rule, 10).allowed).toBe(true);
    l.reset('a');
    expect(l.hit('a', rule, 11).allowed).toBe(true);
  });

  it('ships stricter per-email than per-IP rules for sign-in', () => {
    expect(AUTH_RATE_RULES.signInEmail.limit).toBeLessThan(AUTH_RATE_RULES.signInIp.limit);
  });
});
