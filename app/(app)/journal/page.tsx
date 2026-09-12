import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Journal' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journal" />
      <EmptyState
        title="Your readings will collect here"
        description="The first one is the start of your timeline."
      />
    </>
  );
}
