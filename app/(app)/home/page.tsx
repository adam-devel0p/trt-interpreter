import Link from 'next/link';
import { FIRST_READING_PATH } from '@/auth/routes';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Home' };

/**
 * Home (§5): fast start and current context. One primary action, one slot for an unresolved
 * reading, one slot for a single relevant insight. Never a dashboard (§4.3): no counters, no
 * greeting, no grid of charts.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Home" />
      <div className="mb-8 flex flex-col gap-3">
        <Button asChild size="lg" className="w-full">
          <Link href={FIRST_READING_PATH}>Start a reading</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/decks">Browse the decks</Link>
        </Button>
      </div>
      <section aria-labelledby="unresolved-heading" className="mb-8">
        <h2 id="unresolved-heading" className="mb-3 font-serif text-xl">
          Still open
        </h2>
        <EmptyState
          title="Nothing waiting on you"
          description="When a reading asks a question you haven't answered yet, it will sit here until you say what happened."
        />
      </section>
      <section aria-labelledby="insight-heading">
        <h2 id="insight-heading" className="mb-3 font-serif text-xl">
          Worth a look
        </h2>
        <EmptyState
          title="No insight yet"
          description="After a few readings, one connection at a time will appear here — with the entries it came from."
        />
      </section>
    </>
  );
}
