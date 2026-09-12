import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../circuitBreaker';

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures and closes after cooldown', () => {
    let t = 0;
    const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    t = 999;
    expect(cb.isOpen()).toBe(true);
    t = 1000;
    expect(cb.isOpen()).toBe(false); // half-open
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true); // re-opens on the first failure while half-open
  });

  it('a success resets the count', () => {
    const cb = new CircuitBreaker({ threshold: 2 });
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
  });
});
