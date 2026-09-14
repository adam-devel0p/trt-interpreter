import Link from 'next/link';
import { getSessionClient, requireUser } from '@/auth/session';
import { listEvents } from '@/db/queries/events';
import { groupByMonth } from '@/domain/journal/filters';
import { eventTypeLabel } from '@/domain/events/types';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Life events' };
export const dynamic = 'force-dynamic';

/** The events, newest first, by month. Stored rows only. */
export default async function EventsPage() {
  await requireUser();
  const events = await listEvents(await getSessionClient());
  const groups = groupByMonth(events, (e) => `${e.occurred_on}T12:00:00Z`);
  return (
    <>
      <PageHeader
        title="Life events"
        description="What actually happened, in your words. Connected to readings only when you say so."
        action={
          <Button asChild size="sm">
            <Link href="/event/new">Something happened</Link>
          </Button>
        }
      />
      {events.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          description="One sentence is enough: “I accepted the new job today.” The app may then suggest which past readings it relates to."
          action={
            <Button asChild>
              <Link href="/event/new">Log the first one</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`events-${g.key}`}>
              <h2
                id={`events-${g.key}`}
                className="sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase backdrop-blur"
              >
                {g.label}
              </h2>
              <ol className="mt-1 flex flex-col gap-2">
                {g.items.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/event/${e.id}`}
                      className="block rounded-card border-l-2 border-hairline-strong bg-surface px-4 py-3 hairline hover:bg-surface-2"
                    >
                      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                        <LocalTime iso={`${e.occurred_on}T12:00:00Z`} dateOnly />
                        {eventTypeLabel(e.event_type) ? (
                          <span className="tracking-normal normal-case">
                            {' '}
                            · {eventTypeLabel(e.event_type)!.toLowerCase()}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 font-serif text-lg leading-snug">{e.description}</p>
                      <p className="mt-1 text-xs text-fg-muted">
                        {e.confirmed_links
                          ? `Connected to ${e.confirmed_links} reading${e.confirmed_links === 1 ? '' : 's'}`
                          : 'Not connected to a reading'}
                        {e.media_count ? ' · photo' : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
