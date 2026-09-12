import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Offline' };

/** Served by the service worker when the network is unavailable. */
export default function OfflinePage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4">
      <PageHeader title="You're offline" />
      <EmptyState
        title="No connection right now"
        description="Nothing you've saved is lost. Your journal will be here when you're back online."
      />
    </div>
  );
}
