import Link from 'next/link';
import { FIRST_READING_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { listDueRevisits } from '@/db/queries/events';
import { nextSuggestedJourney } from '@/db/queries/journeys';
import { listReadings } from '@/db/queries/readings';
import { SuggestedJourneyCard } from '../journey/suggested-card';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';
import { LocalTime } from '@/ui/components/local-time';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

/**
 * Home (§5): fast start and current context. One primary action, one slot for an unresolved
 * reading, one slot for a single relevant insight. Never a dashboard (§4.3): no counters, no
 * greeting, no grid of charts.
 */
export default async function Page() {
  await requireUser();
  const client = await getSessionClient();
  const [open, suggested, due] = await Promise.all([
    listReadings(client, { limit: 1, followUp: 'unresolved' }).then((r) => r[0]),
    nextSuggestedJourney(client),
    listDueRevisits(client, { limit: 2 }),
  ]);
  return (
    <>
      <PageHeader title="Home" />
      <div className="mb-8 flex flex-col gap-3">
        <Button asChild size="lg" className="w-full">
          <Link href={FIRST_READING_PATH}>Start a reading</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/event/new">Something happened</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/decks">Browse the decks</Link>
          </Button>
        </div>
      </div>
      {due.length ? (
        <section aria-labelledby="revisit-heading" className="mb-8" data-testid="due-revisits">
          <h2 id="revisit-heading" className="mb-3 font-serif text-xl">
            You asked to come back to this
          </h2>
          <ul className="flex flex-col gap-2">
            {due.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/reading/${r.id}#follow-up-h`}
                  data-deck={r.deck.system}
                  className="block rounded-card border-l-2 border-accent bg-surface px-4 py-3 hairline hover:bg-surface-2"
                >
                  <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    <LocalTime iso={r.occurred_at} dateOnly />
                    <span className="tracking-normal normal-case"> · {r.deck.name}</span>
                  </p>
                  <p className="mt-1 font-serif text-lg leading-snug">
                    {r.is_open_reflection ? 'Open reflection' : r.question}
                  </p>
                  <p className="mt-1 text-sm text-fg-muted">
                    You asked about this {daysAgo(r.occurred_at)} — what happened? Say so when you
                    know; no rush.
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="unresolved-heading" className="mb-8">
        <h2 id="unresolved-heading" className="mb-3 font-serif text-xl">
          Still open
        </h2>
        {open ? (
          <Link
            href={`/reading/${open.id}`}
            data-deck={open.deck.system}
            className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
          >
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
              <LocalTime iso={open.occurred_at} />
              <span className="tracking-normal normal-case">
                {' '}
                · {open.spread.name} · {open.deck.name}
              </span>
            </p>
            <p className="mt-1 font-serif text-lg leading-snug">
              {open.is_open_reflection ? 'Open reflection' : open.question}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {open.revisit_at
                ? 'You asked to revisit this. Say what happened when you know.'
                : 'Not resolved yet. Say what happened when you know.'}
            </p>
          </Link>
        ) : (
          <EmptyState
            title="Nothing waiting on you"
            description="When a reading asks a question you haven't answered yet, it will sit here until you say what happened."
          />
        )}
      </section>
      <section aria-labelledby="insight-heading">
        <h2 id="insight-heading" className="mb-3 font-serif text-xl">
          Worth a look
        </h2>
        {suggested ? (
          <SuggestedJourneyCard journey={suggested} />
        ) : (
          <EmptyState
            title="No insight yet"
            description="After a few readings, one connection at a time will appear here — with the entries it came from."
          />
        )}
      </section>
    </>
  );
}

/** "30 days ago", "about two months ago" — content-anchored, never a count of missed days. */
function daysAgo(iso: string): string {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'about a month ago' : `about ${months} months ago`;
}
