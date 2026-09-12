/**
 * Sliding-window rate limiter for auth endpoints (spec §11: rate-limit auth). Pure logic over an
 * injectable store so it is unit-testable and swappable for a shared store (Phase 12 hardening:
 * this in-memory store is per server instance, which is honest but weak on serverless).
 */

export interface RateLimitRule {
  /** Maximum hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest hit in the window expires (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimitStore {
  /** Timestamps of hits for a key, oldest first. */
  get(key: string): number[] | undefined;
  set(key: string, hits: number[]): void;
  delete(key: string): void;
}

export function createMemoryStore(): RateLimitStore {
  const map = new Map<string, number[]>();
  return {
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k),
  };
}

export interface RateLimiter {
  /** Record a hit and decide. Keys are opaque; callers namespace them (`sign_in:ip:…`). */
  hit(key: string, rule: RateLimitRule, now?: number): RateLimitDecision;
  /** Look without recording. */
  peek(key: string, rule: RateLimitRule, now?: number): RateLimitDecision;
  reset(key: string): void;
}

export function createRateLimiter(store: RateLimitStore = createMemoryStore()): RateLimiter {
  const prune = (key: string, rule: RateLimitRule, now: number): number[] => {
    const cutoff = now - rule.windowMs;
    const hits = (store.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length === 0) store.delete(key);
    else store.set(key, hits);
    return hits;
  };
  const decide = (hits: number[], rule: RateLimitRule, now: number): RateLimitDecision => {
    if (hits.length < rule.limit) {
      return { allowed: true, remaining: rule.limit - hits.length, retryAfterMs: 0 };
    }
    const oldest = hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + rule.windowMs - now),
    };
  };
  return {
    hit(key, rule, now = Date.now()) {
      const hits = prune(key, rule, now);
      const decision = decide(hits, rule, now);
      if (decision.allowed) {
        hits.push(now);
        store.set(key, hits);
        return { ...decision, remaining: decision.remaining - 1 };
      }
      return decision;
    },
    peek(key, rule, now = Date.now()) {
      return decide(prune(key, rule, now), rule, now);
    },
    reset(key) {
      store.delete(key);
    },
  };
}

/**
 * Auth endpoint rules. Per-email limits are the tight ones (they stop targeting); per-IP limits
 * are loose enough for a shared NAT and catch spraying. Buckets reset with the server process.
 */
export const AUTH_RATE_RULES = {
  signInIp: { limit: 40, windowMs: 15 * 60_000 },
  signInEmail: { limit: 8, windowMs: 15 * 60_000 },
  signUpIp: { limit: 30, windowMs: 60 * 60_000 },
  emailLinkIp: { limit: 30, windowMs: 15 * 60_000 },
  emailLinkEmail: { limit: 4, windowMs: 15 * 60_000 },
  passwordUpdate: { limit: 6, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;
