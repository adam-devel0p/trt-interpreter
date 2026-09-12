import Link from 'next/link';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-16">
      <EmptyState
        title="That page isn't here"
        description="The link may be old, or the page hasn't been built yet."
        action={
          <Button asChild variant="secondary">
            <Link href="/home">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}
