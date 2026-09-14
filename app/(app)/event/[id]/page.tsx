import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getEvent, listLinksForObject, loadLinkedObjects } from '@/db/queries/events';
import { getReadingJourneys } from '@/db/queries/journeys';
import { eventTypeLabel } from '@/domain/events/types';
import { flag } from '@/flags';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { JourneyPanel } from '../../reading/[id]/journey-panel';
import { ConnectionReview, type ConnectionItem } from '../connection-review';
import { EventControls, RefreshWhile } from './controls';

export const dynamic = 'force-dynamic';

/** Suggestions are expected within this long of saving; after that the screen stops waiting. */
const WAIT_FOR_JOBS_MS = 3 * 60_000;

/**
 * Life event detail (spec §6.4, FR-12): the sentence, the date, the photo, then the
 * connection review — at most three proposals with their reasons, or an honest "nothing
 * found". Everything is stored rows; opening this makes no model call.
 */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; photo?: string }>;
}) {
  const [{ id }, { saved, photo }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  const client = await getSessionClient();
  const event = await getEvent(client, id);
  if (!event) notFound();
  const [links, journeys, suggestionsOn] = await Promise.all([
    listLinksForObject(client, { type: 'life_event', id }),
    getReadingJourneys(client, id, 'life_event'),
    flag('correlation_suggestions', { userId: user.id }),
  ]);
  const linked = await loadLinkedObjects(client, links);
  const items: ConnectionItem[] = links.map((link) => {
    const r = linked.readings.get(link.from_id);
    return { link, other: r ? { kind: 'reading', ...r } : { kind: 'missing' } };
  });
  const proposals = items.filter((i) => i.link.state === 'pending');
  const decided = items.filter((i) => i.link.state !== 'pending');
  const waiting =
    suggestionsOn &&
    event.correlated_at === null &&
    Date.now() - Date.parse(event.created_at) < WAIT_FOR_JOBS_MS;
  const typeLabel = eventTypeLabel(event.event_type);

  return (
    <article className="pb-8">
      <RefreshWhile active={!!waiting} />
      {saved === '1' ? (
        <p role="status" className="mb-4 rounded-card bg-accent-soft px-4 py-3 text-sm">
          Saved.{' '}
          {photo === 'failed' ? 'The photo could not be attached — the event itself is safe. ' : ''}
          {suggestionsOn
            ? 'If it relates to a past reading, a suggestion will appear below shortly.'
            : 'It is now part of your timeline.'}
        </p>
      ) : null}
      <PageHeader
        eyebrow="Life event"
        title={event.description}
        description={
          <>
            <LocalTime iso={`${event.occurred_on}T12:00:00Z`} dateOnly />
            {typeLabel ? (
              <span className="text-fg-muted"> · {typeLabel.toLowerCase()} — suggested</span>
            ) : null}
          </>
        }
        action={
          <Link href="/event" className="text-sm text-accent underline underline-offset-4">
            All events
          </Link>
        }
      />
      {event.note ? (
        <section aria-labelledby="event-note-h" className="mt-2">
          <h2 id="event-note-h" className="sr-only">
            Note
          </h2>
          <p className="prose-content whitespace-pre-wrap">{event.note}</p>
        </section>
      ) : null}
      {event.media.length ? (
        <ul className="mt-4 flex flex-wrap gap-3" aria-label="Photos">
          {event.media.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- owner-scoped signed URL via our route */}
              <img
                src={`/api/events/media/${m.id}`}
                alt={m.alt_text ?? 'Photo attached to this event'}
                className="max-h-72 rounded-card object-cover hairline"
                loading="lazy"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {event.origin ? (
        <p className="mt-4 text-sm text-fg-muted">
          Logged about{' '}
          <Link
            href={`/reading/${event.origin.id}`}
            className="text-accent underline underline-offset-4"
          >
            {event.origin.is_open_reflection ? 'an open reflection' : event.origin.question}
          </Link>{' '}
          (<LocalTime iso={event.origin.occurred_at} dateOnly />
          ).
        </p>
      ) : null}

      <section aria-labelledby="connections-h" className="mt-8" data-section="connections">
        <h2 id="connections-h" className="mb-1 font-serif text-xl">
          Connections to readings
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          Suggested from what your entries share — never from the cards alone. You decide.
        </p>
        {proposals.length ? (
          <ConnectionReview items={proposals} />
        ) : waiting ? (
          <p
            role="status"
            className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-sm text-fg-muted"
          >
            Looking through your past readings…
          </p>
        ) : decided.length === 0 ? (
          <p className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-sm text-fg-muted">
            {suggestionsOn && event.correlated_at
              ? 'No connection found. That is a normal result — not everything relates to a reading. You can still link one yourself from the reading’s Follow-up section.'
              : suggestionsOn
                ? 'Connections could not be checked yet. This event is complete on its own.'
                : 'Connection suggestions are off for this account. You can link a reading yourself from its Follow-up section.'}
          </p>
        ) : null}
        {decided.length ? (
          <div className={proposals.length ? 'mt-4' : ''}>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
              Decided
            </h3>
            <ConnectionReview items={decided} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="event-journeys-h" className="mt-8" data-testid="event-journeys">
        <h2 id="event-journeys-h" className="mb-2 font-serif text-xl">
          Journeys
        </h2>
        <JourneyPanel
          readingId={event.id}
          objectType="life_event"
          memberships={journeys.memberships}
          options={journeys.options}
        />
      </section>

      <section aria-labelledby="event-controls-h" className="mt-8">
        <h2 id="event-controls-h" className="mb-2 font-serif text-xl">
          Controls
        </h2>
        <EventControls
          eventId={event.id}
          occurredOn={event.occurred_on}
          connections={decided.filter((d) => d.link.state === 'confirmed').length}
          photos={event.media.length}
        />
      </section>
    </article>
  );
}

export async function generateMetadata() {
  return { title: 'Life event' };
}
