import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Home' };

export default function Page() {
  return (
    <>
      <PageHeader title="Home" />
      <EmptyState
        title="Nothing here yet"
        description="Your first reading is the start of your timeline. The reading loop arrives in Phase 03."
      />
    </>
  );
}
