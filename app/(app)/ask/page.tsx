import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Ask my history' };

export default function Page() {
  return (
    <>
      <PageHeader title="Ask my history" />
      <EmptyState
        title="Nothing to ask about yet"
        description="Once you have a few readings saved, you can ask questions about your own history and get answers with sources."
      />
    </>
  );
}
