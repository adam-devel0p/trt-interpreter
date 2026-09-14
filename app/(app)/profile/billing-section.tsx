import { paywallOffer } from '@/billing/offer';
import { loadEntitlements } from '@/billing/gate';
import { describeSubscription } from '@/domain/billing/pricing';
import type { SubscriptionView } from '@/db/queries/billing';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { PaywallSheet } from '@/ui/components/premium-offer';
import { SettingsRow, SettingsSection } from '@/ui/components/settings';
import {
  notePaywallViewedAction,
  openBillingPortalAction,
  startCheckoutAction,
} from '../billing/checkout-actions';

/**
 * Profile → Subscription (§14, §4.8). The plan in one plain sentence with its real dates, the
 * allowance used this month, and one control: "Manage billing" (the provider's portal, where
 * cancelling is one tap) or "See Premium" (the sheet). The archive line is on every plan.
 */
export async function BillingSection({
  userId,
  subscription,
  notice,
}: {
  userId: string;
  subscription: SubscriptionView | null;
  notice?: string;
}) {
  const [ent, offer] = await Promise.all([
    loadEntitlements(userId),
    paywallOffer(userId, 'interpretation'),
  ]);
  const interp = ent.features.interpretation;
  const analysis = ent.features.summaries;
  const hasBilling = Boolean(subscription?.provider_customer_id);
  const plan = describeSubscription(
    subscription
      ? {
          status: subscription.status,
          interval: subscription.interval,
          trialEnd: subscription.trial_end,
          currentPeriodEnd: subscription.current_period_end,
          cancelAt: subscription.cancel_at,
        }
      : null,
  );
  const paused = subscription?.status === 'past_due' || subscription?.status === 'unpaid';

  return (
    <div id="billing" className="scroll-mt-4">
      <SettingsSection title="Subscription">
        {notice === 'success' ? (
          <div className="px-4 pt-3">
            <FormMessage tone="info">Thank you. Premium is on for this account.</FormMessage>
          </div>
        ) : notice === 'unavailable' ? (
          <div className="px-4 pt-3">
            <FormMessage tone="error">
              Billing is not reachable right now. Nothing changed; try again later.
            </FormMessage>
          </div>
        ) : null}
        <SettingsRow
          label="Plan"
          description={`${plan} Your archive stays readable whatever the plan.`}
          control={
            hasBilling ? (
              <form action={openBillingPortalAction}>
                <Button type="submit" variant="secondary" size="sm">
                  {paused ? 'Update payment' : 'Manage billing'}
                </Button>
              </form>
            ) : (
              <PaywallSheet
                trigger={
                  <Button type="button" variant="secondary" size="sm">
                    See Premium
                  </Button>
                }
                offer={offer}
                context="Premium adds analysis on top of the journal you already keep."
                stillWorks="Reading, searching, editing, exporting and deleting your entries never depend on a plan."
                returnTo="/profile"
                action={startCheckoutAction}
                onViewed={notePaywallViewedAction}
              />
            )
          }
        />
        <SettingsRow
          label="Interpretations this month"
          description={
            interp.limit === null
              ? 'Unlimited.'
              : `${interp.used} of ${interp.limit} used. The count starts again on the first of the month (UTC).`
          }
        />
        {ent.plan === 'premium' ? (
          <SettingsRow
            label="Analysis this month"
            description={`${analysis.used} of ${analysis.limit} — questions, summaries and connection explanations together.`}
          />
        ) : null}
      </SettingsSection>
    </div>
  );
}
