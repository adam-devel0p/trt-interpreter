import 'server-only';
import {
  effectivePlan,
  entitlements,
  type Entitlements,
  type Feature,
  type FeatureEntitlement,
} from '@/domain/billing/entitlements';
import { loadSubscription } from './subscriptions';
import { readUsage } from './usage';

/**
 * The gate every premium or metered action goes through (§14). Loads the subscription and
 * this month's counters, hands both to the one pure `entitlements()` and returns the
 * verdict. Nothing else in the tree may import `@/domain/billing/entitlements`
 * (lint-enforced), so this is the only place a plan turns into a yes or a no.
 *
 * Nothing that reads, edits, exports or deletes stored content calls this (invariant 11).
 */
export async function loadEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  const [sub, usage] = await Promise.all([loadSubscription(userId), readUsage(userId, now)]);
  return entitlements(effectivePlan(sub), usage);
}

export async function checkFeatureFor(
  userId: string,
  feature: Feature,
): Promise<FeatureEntitlement> {
  return (await loadEntitlements(userId)).features[feature];
}
