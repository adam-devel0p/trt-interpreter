import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Journeys' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journeys" />
      <EmptyState
        title="No journeys yet"
        description="As readings and life events accumulate, related ones gather here on their own — you never file anything by hand."
      />
    </>
  );
}
