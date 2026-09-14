import { describe, expect, it } from 'vitest';
import {
  checkFeature,
  effectivePlan,
  entitlements,
  FEATURE_PLAN,
  FEATURES,
  featureForTask,
  PLAN_LIMITS,
  SUBSCRIPTION_STATUSES,
  TASK_FEATURE,
  type Feature,
  type PlanId,
} from '../entitlements';

/**
 * The truth table (phase 11 test plan): plan × counters × feature, and every limit at its
 * exact boundary. Anything that reads or edits stored content has no row here on purpose —
 * there is no "read the archive" feature to check (invariant 11).
 */
describe('entitlements()', () => {
  const plans: PlanId[] = ['free', 'premium'];

  it('with no usage, free gets exactly the free features and premium gets everything', () => {
    for (const plan of plans) {
      const e = entitlements(plan);
      for (const f of FEATURES) {
        const expected = FEATURE_PLAN[f] === 'free' || plan === 'premium';
        expect(e.features[f].allowed, `${plan}/${f}`).toBe(expected);
        expect(e.features[f].reason).toBe(expected ? null : 'plan');
      }
    }
  });

  it('a premium-only feature on free is denied for the plan, never for a count', () => {
    const e = checkFeature('free', 'ask_my_history', { month: { ask_my_history: 0 }, today: 0 });
    expect(e).toMatchObject({ allowed: false, reason: 'plan', used: 0, limit: 0, remaining: 0 });
  });

  it('the interpretation allowance: one under passes, at the limit denies, the reason is monthly', () => {
    const limit = PLAN_LIMITS.free.interpretationsPerMonth;
    expect(
      checkFeature('free', 'interpretation', { month: { interpretation: limit - 1 }, today: 0 }),
    ).toMatchObject({ allowed: true, used: limit - 1, remaining: 1 });
    expect(
      checkFeature('free', 'interpretation', { month: { interpretation: limit }, today: 0 }),
    ).toMatchObject({ allowed: false, reason: 'monthly', remaining: 0 });
    // Premium's allowance is higher, and the same boundary rule applies.
    const p = PLAN_LIMITS.premium.interpretationsPerMonth;
    expect(p).toBeGreaterThan(limit);
    expect(
      checkFeature('premium', 'interpretation', { month: { interpretation: p }, today: 0 }).reason,
    ).toBe('monthly');
  });

  it('analysis features share one monthly bucket on premium', () => {
    const limit = PLAN_LIMITS.premium.analysisCallsPerMonth;
    const counters = {
      month: { ask_my_history: limit - 2, summaries: 1, correlation_explanations: 1 },
      today: 0,
    };
    for (const f of ['ask_my_history', 'summaries', 'correlation_explanations'] as Feature[]) {
      const e = checkFeature('premium', f, counters);
      expect(e.used).toBe(limit);
      expect(e.allowed).toBe(false);
      expect(e.reason).toBe('monthly');
    }
  });

  it('the day cap denies every feature with reason daily, and monthly denial wins over daily', () => {
    const cap = PLAN_LIMITS.free.callsPerDay;
    const e = entitlements('free', { month: {}, today: cap });
    for (const f of FEATURES)
      if (FEATURE_PLAN[f] === 'free') expect(e.features[f].reason).toBe('daily');
    expect(e.today).toEqual({ used: cap, limit: cap });
    expect(
      entitlements('free', { month: {}, today: cap - 1 }).features.interpretation.allowed,
    ).toBe(true);
    const both = checkFeature('free', 'interpretation', {
      month: { interpretation: PLAN_LIMITS.free.interpretationsPerMonth },
      today: cap,
    });
    expect(both.reason).toBe('monthly');
  });

  it('support tasks have no monthly bucket (they ride along with an interpretation)', () => {
    const e = checkFeature('free', 'support', { month: { support: 10_000 }, today: 0 });
    expect(e).toMatchObject({ allowed: true, limit: null, remaining: null });
  });

  it('memory is free but cost-capped', () => {
    const cap = PLAN_LIMITS.free.memoryCallsPerMonth;
    expect(checkFeature('free', 'memory', { month: { memory: cap - 1 }, today: 0 }).allowed).toBe(
      true,
    );
    expect(checkFeature('free', 'memory', { month: { memory: cap }, today: 0 }).reason).toBe(
      'monthly',
    );
  });

  it('premium is the deeper interpretation tier', () => {
    expect(PLAN_LIMITS.free.interpretationTier).toBe('standard');
    expect(PLAN_LIMITS.premium.interpretationTier).toBe('deep');
  });
});

describe('effectivePlan()', () => {
  it('trialing and active are premium; every other provider state, and no row, is free', () => {
    expect(effectivePlan(null)).toBe('free');
    expect(effectivePlan(undefined)).toBe('free');
    for (const status of SUBSCRIPTION_STATUSES) {
      const expected = status === 'trialing' || status === 'active' ? 'premium' : 'free';
      expect(effectivePlan({ status }), status).toBe(expected);
    }
  });

  it('past_due pauses premium analysis without touching anything else (there is nothing else here)', () => {
    const e = entitlements(effectivePlan({ status: 'past_due' }));
    expect(e.plan).toBe('free');
    expect(e.features.ask_my_history.reason).toBe('plan');
    expect(e.features.interpretation.allowed).toBe(true);
  });
});

describe('featureForTask()', () => {
  it('maps every task and throws for an unknown one', () => {
    for (const task of Object.keys(TASK_FEATURE)) expect(FEATURES).toContain(featureForTask(task));
    expect(() => featureForTask('not_a_task')).toThrow();
  });
});
