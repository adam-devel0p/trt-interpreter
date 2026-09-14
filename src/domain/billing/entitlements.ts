/**
 * Entitlements (spec §14, invariant 11). **The single feature check in the tree.** Every gate
 * — the AI budget hook, the Ask page, the regenerate buttons, the summary sweep — calls
 * `entitlements()` and reads one `FeatureEntitlement`; nothing else compares a plan string.
 * A lint restriction (`eslint.config.mjs`, `NO_ENTITLEMENTS_OUTSIDE_BILLING`) keeps this module
 * importable only from `src/billing/` and `src/ai/telemetry.ts`.
 *
 * What is metered is **new analysis** only. Reading, searching, editing, exporting and deleting
 * stored content have no entitlement at all — they never reach this module (invariant 11).
 *
 * Packaging (§14 "recommended initial packaging"). The numbers are placeholders until retention
 * data exists (§14 "do not optimise pricing before retention is demonstrated"): change them
 * here, nowhere else.
 */

export type PlanId = 'free' | 'premium';

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** What a model task is metered under. */
export const FEATURES = [
  /** `interpret_reading`: the free allowance per month, premium higher. */
  'interpretation',
  /** Safety and repeat-question classifiers: ride along with an interpretation, day cap only. */
  'support',
  /** Extraction, entity and journey proposals, retrieval documents: free, cost-capped. */
  'memory',
  /** Ask My History (`parse_history_query`, `answer_from_evidence`). */
  'ask_my_history',
  /** The sentence on a suggested connection (`explain_correlation`). */
  'correlation_explanations',
  /** Period summaries and journey narratives (`summarize_period`, `journey_narrative`). */
  'summaries',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Every model task → the feature it is metered under. Kept in sync with `TASK_IDS` by a test. */
export const TASK_FEATURE: Readonly<Record<string, Feature>> = {
  interpret_reading: 'interpretation',
  classify_safety: 'support',
  detect_repeat_question: 'support',
  extract_reading_metadata: 'memory',
  extract_event_metadata: 'memory',
  propose_entity_candidates: 'memory',
  propose_journey: 'memory',
  build_retrieval_document: 'memory',
  explain_correlation: 'correlation_explanations',
  parse_history_query: 'ask_my_history',
  answer_from_evidence: 'ask_my_history',
  summarize_period: 'summaries',
  journey_narrative: 'summaries',
};

export function featureForTask(task: string): Feature {
  const f = TASK_FEATURE[task];
  if (!f) throw new Error(`No feature for task ${task}`);
  return f;
}

/** The lowest plan a feature is included in. Premium-only features have no free allowance. */
export const FEATURE_PLAN: Readonly<Record<Feature, PlanId>> = {
  interpretation: 'free',
  support: 'free',
  memory: 'free',
  ask_my_history: 'premium',
  correlation_explanations: 'premium',
  summaries: 'premium',
};

export interface PlanLimits {
  /** Successful `interpret_reading` runs per calendar month (UTC). */
  interpretationsPerMonth: number;
  /** Successful memory-feature runs per month — a cost cap, not a product limit. */
  memoryCallsPerMonth: number;
  /** Successful premium-analysis runs per month across ask, explanations and summaries. */
  analysisCallsPerMonth: number;
  /** Any successful run per UTC day — an abuse cap. */
  callsPerDay: number;
  /** Model tier for a reading interpretation (§14 "deeper model"). */
  interpretationTier: 'standard' | 'deep';
}

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanLimits>> = {
  free: {
    interpretationsPerMonth: 10,
    memoryCallsPerMonth: 300,
    analysisCallsPerMonth: 0,
    callsPerDay: 120,
    interpretationTier: 'standard',
  },
  premium: {
    interpretationsPerMonth: 300,
    memoryCallsPerMonth: 1500,
    analysisCallsPerMonth: 300,
    callsPerDay: 500,
    interpretationTier: 'deep',
  },
};

/** Which monthly bucket a feature counts against. */
const MONTHLY_BUCKET: Readonly<Record<Feature, keyof PlanLimits | null>> = {
  interpretation: 'interpretationsPerMonth',
  support: null,
  memory: 'memoryCallsPerMonth',
  ask_my_history: 'analysisCallsPerMonth',
  correlation_explanations: 'analysisCallsPerMonth',
  summaries: 'analysisCallsPerMonth',
};

/** Features that share one monthly bucket are summed together. */
export function bucketFeatures(bucket: keyof PlanLimits): Feature[] {
  return FEATURES.filter((f) => MONTHLY_BUCKET[f] === bucket);
}

/** Successful runs this month by feature, and any successful run today. */
export interface UsageCounters {
  month: Partial<Record<Feature, number>>;
  today: number;
}

export const EMPTY_USAGE: UsageCounters = { month: {}, today: 0 };

export type DenyReason = 'plan' | 'monthly' | 'daily';

export interface FeatureEntitlement {
  feature: Feature;
  allowed: boolean;
  reason: DenyReason | null;
  /** Successful runs against this feature's monthly bucket so far. */
  used: number;
  /** The bucket's monthly limit; null when the feature has no monthly bucket. */
  limit: number | null;
  remaining: number | null;
}

export interface Entitlements {
  plan: PlanId;
  limits: PlanLimits;
  features: Record<Feature, FeatureEntitlement>;
  /** Successful runs today against the day cap. */
  today: { used: number; limit: number };
}

/**
 * The plan a subscription state earns. `trialing` and `active` are premium; `past_due` keeps
 * the archive (everything does) and pauses new premium analysis until payment is sorted, which
 * is what "free" means here; every terminal or unpaid state is free.
 */
export function effectivePlan(
  subscription: { status: SubscriptionStatus | string; plan?: string } | null | undefined,
): PlanId {
  if (!subscription) return 'free';
  return subscription.status === 'trialing' || subscription.status === 'active'
    ? 'premium'
    : 'free';
}

/** The truth table: plan × counters → what is allowed now, and why not. */
export function entitlements(plan: PlanId, counters: UsageCounters = EMPTY_USAGE): Entitlements {
  const limits = PLAN_LIMITS[plan];
  const dayExhausted = counters.today >= limits.callsPerDay;
  const features = {} as Record<Feature, FeatureEntitlement>;
  for (const feature of FEATURES) {
    const bucket = MONTHLY_BUCKET[feature];
    const limit = bucket ? (limits[bucket] as number) : null;
    const used = bucket
      ? bucketFeatures(bucket).reduce((n, f) => n + (counters.month[f] ?? 0), 0)
      : 0;
    const planOk = FEATURE_PLAN[feature] === 'free' || plan === 'premium';
    let reason: DenyReason | null = null;
    if (!planOk) reason = 'plan';
    else if (limit !== null && used >= limit) reason = limit === 0 ? 'plan' : 'monthly';
    else if (dayExhausted) reason = 'daily';
    features[feature] = {
      feature,
      allowed: reason === null,
      reason,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }
  return {
    plan,
    limits,
    features,
    today: { used: counters.today, limit: limits.callsPerDay },
  };
}

/** Convenience for the gates: one feature's verdict. */
export function checkFeature(
  plan: PlanId,
  feature: Feature,
  counters: UsageCounters = EMPTY_USAGE,
): FeatureEntitlement {
  return entitlements(plan, counters).features[feature];
}
