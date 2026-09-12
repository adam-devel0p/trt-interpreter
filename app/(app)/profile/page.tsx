import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Profile' };

export default function Page() {
  return (
    <>
      <PageHeader title="Profile" />
      <EmptyState
        title="Profile arrives in Phase 01"
        description="Decks, reversals, AI consent, export and delete will live here — export and delete are always two taps away."
      />
    </>
  );
}
