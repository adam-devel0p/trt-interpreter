import 'server-only';
import type { DenyReason, Feature, PlanId } from '@/domain/billing/entitlements';
import { priceLines, type PriceLine } from '@/domain/billing/pricing';
import { pricing } from './config';
import { loadEntitlements } from './gate';
import { loadSubscription } from './subscriptions';

/**
 * What a paywall needs to say, computed once per page (§14, §4.8): the verdict for the
 * feature at hand, the two prices (annual first), whether a trial is still available, and
 * the allowance figures so limit copy can be exact.
 */
export interface PaywallOffer {
  plan: PlanId;
  feature: Feature;
  allowed: boolean;
  reason: DenyReason | null;
  used: number;
  limit: number | null;
  lines: PriceLine[];
  trialDays: number;
  trialAvailable: boolean;
  /** `status` of an existing subscription row, for the wording on a paused plan. */
  status: string | null;
}

export async function paywallOffer(userId: string, feature: Feature): Promise<PaywallOffer> {
  const [ent, sub] = await Promise.all([loadEntitlements(userId), loadSubscription(userId)]);
  const p = pricing();
  const f = ent.features[feature];
  return {
    plan: ent.plan,
    feature,
    allowed: f.allowed,
    reason: f.reason,
    used: f.used,
    limit: f.limit,
    lines: priceLines(p),
    trialDays: p.trialDays,
    trialAvailable: p.trialDays > 0 && !sub?.trialUsedAt,
    status: sub?.status ?? null,
  };
}
