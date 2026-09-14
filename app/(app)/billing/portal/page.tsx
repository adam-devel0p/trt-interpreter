import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/session';
import { loadSubscription } from '@/billing/subscriptions';
import { serverEnv } from '@/config/env.server';
import { describeSubscription } from '@/domain/billing/pricing';
import { Button } from '@/ui/components/button';
import { PageHeader } from '@/ui/components/page-header';
import { fakePortalAction } from '../actions';

export const metadata = { title: 'Billing portal (local)' };
export const dynamic = 'force-dynamic';

/**
 * The fake provider's customer portal: cancel (at period end or now), resume, and the
 * two things a test needs to simulate — a failed payment and a renewal.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (serverEnv().BILLING_PROVIDER !== 'fake') notFound();
  const user = await requireUser();
  const params = await searchParams;
  const sub = await loadSubscription(user.id);
  const returnTo = params.return?.startsWith('/') ? params.return : '/profile#billing';
  const ops: { op: string; label: string; variant?: 'secondary' | 'destructive' }[] = [
    {
      op: 'cancel_at_period_end',
      label: 'Cancel at the end of the period',
      variant: 'destructive',
    },
    { op: 'cancel_now', label: 'Cancel now', variant: 'destructive' },
    { op: 'resume', label: 'Resume (undo cancellation)', variant: 'secondary' },
    { op: 'payment_failed', label: 'Simulate a failed payment', variant: 'secondary' },
    { op: 'pay_now', label: 'Simulate a successful payment', variant: 'secondary' },
    { op: 'renew', label: 'Simulate a renewal', variant: 'secondary' },
  ];
  return (
    <>
      <PageHeader
        title="Test billing portal"
        description="The local stand-in for the payment provider's portal."
      />
      <p className="mb-4 text-sm text-fg-muted">
        {describeSubscription(
          sub
            ? {
                status: sub.status,
                interval: sub.interval,
                trialEnd: sub.trialEnd?.toISOString() ?? null,
                currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
                cancelAt: sub.cancelAt?.toISOString() ?? null,
              }
            : null,
        )}
      </p>
      <div className="flex max-w-sm flex-col gap-2">
        {ops.map((o) => (
          <form key={o.op} action={fakePortalAction}>
            <input type="hidden" name="op" value={o.op} />
            <input type="hidden" name="return" value={returnTo} />
            <Button type="submit" variant={o.variant ?? 'primary'} className="w-full">
              {o.label}
            </Button>
          </form>
        ))}
        <Button asChild variant="ghost">
          <a href={returnTo}>Back to the app</a>
        </Button>
      </div>
    </>
  );
}
