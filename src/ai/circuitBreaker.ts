/**
 * Per-provider circuit breaker: opens after `threshold` consecutive provider failures and stays
 * open for `cooldownMs`. Successes reset the count. Pure and clock-injected for tests.
 */
export interface CircuitBreakerOptions {
  threshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: allow traffic again; the next failure re-opens immediately.
      this.openedAt = null;
      this.consecutiveFailures = this.threshold - 1;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) this.openedAt = this.now();
  }

  get failures(): number {
    return this.consecutiveFailures;
  }
}
