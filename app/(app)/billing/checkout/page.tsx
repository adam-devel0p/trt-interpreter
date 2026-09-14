import { notFound } from 'next/navigation';
import { pricing } from '@/billing';
import { serverEnv } from '@/config/env.server';
import { priceLines } from '@/domain/billing/pricing';
import { Button } from '@/ui/components/button';
import { PageHeader } from '@/ui/components/page-header';
import { fakeCheckoutAction } from '../actions';

export const metadata = { title: 'Checkout (local)' };
export const dynamic = 'force-dynamic';

/**
 * The fake provider's hosted checkout. Stands in for Stripe Checkout locally and in e2e:
 * one button completes the purchase by emitting the same events Stripe would. Never
 * reachable when the real provider is configured.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (serverEnv().BILLING_PROVIDER !== 'fake') notFound();
  const params = await searchParams;
  const interval = params.interval === 'month' ? 'month' : 'year';
  const trial = Number(params.trial ?? 0) || 0;
  const line = priceLines(pricing()).find((l) => l.interval === interval)!;
  return (
    <>
      <PageHeader
        title="Test checkout"
        description="This is the local stand-in for the payment provider's page. Nothing is charged anywhere."
      />
      <form action={fakeCheckoutAction} className="flex max-w-sm flex-col gap-4">
        <input type="hidden" name="interval" value={interval} />
        <input type="hidden" name="trial" value={trial} />
        <input type="hidden" name="success" value={params.success ?? '/profile?billing=success'} />
        <dl className="rounded-card bg-surface p-4 text-sm hairline">
          <div className="flex justify-between">
            <dt className="text-fg-muted">Plan</dt>
            <dd>Premium, {interval === 'year' ? 'yearly' : 'monthly'}</dd>
          </div>
          <div className="mt-2 flex justify-between">
            <dt className="text-fg-muted">Price</dt>
            <dd>{line.amount}</dd>
          </div>
          <div className="mt-2 flex justify-between">
            <dt className="text-fg-muted">Trial</dt>
            <dd>{trial > 0 ? `${trial} days free first` : 'None'}</dd>
          </div>
        </dl>
        <div className="flex gap-2">
          <Button type="submit">Complete test purchase</Button>
          <Button asChild variant="secondary">
            <a href={params.cancel ?? '/profile'}>Go back</a>
          </Button>
        </div>
      </form>
    </>
  );
}
