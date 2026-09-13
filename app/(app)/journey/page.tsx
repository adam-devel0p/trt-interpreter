import Link from 'next/link';
import { getSessionClient, requireUser } from '@/auth/session';
import { listJourneys, orderForList, type JourneyListItem } from '@/db/queries/journeys';
import { EmptyState } from '@/ui/components/empty-state';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { NewJourneyForm } from './new-journey';
import { SuggestedJourneyCard } from './suggested-card';

export const metadata = { title: 'Journeys' };
export const dynamic = 'force-dynamic';

/**
 * Journey list (spec §6.5): active first, then the one suggestion (dismissible for good),
 * then dormant and closed. Everything is a stored row; nothing is computed by a model here.
 */
export default async function Page() {
  await requireUser();
  const all = await listJourneys(await getSessionClient());
  const { active, suggested, rest } = orderForList(all);
  const suggestion = suggested[0] ?? null;
  const nothing = active.length === 0 && !suggestion && rest.length === 0;

  return (
    <>
      <PageHeader
        title="Journeys"
        description="The real-life threads your readings keep returning to. They gather on their own — you never file anything."
      />
      {nothing ? (
        <EmptyState
          title="No journeys yet"
          description="As readings about the same person, place or situation accumulate, they gather here on their own. You can also start one yourself."
          action={<NewJourneyForm />}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {suggestion ? <SuggestedJourneyCard journey={suggestion} /> : null}
          {active.length ? (
            <section aria-labelledby="active-h">
              <h2 id="active-h" className="mb-3 font-serif text-xl">
                Ongoing
              </h2>
              <JourneyList items={active} />
            </section>
          ) : null}
          {rest.length ? (
            <section aria-labelledby="rest-h">
              <h2 id="rest-h" className="mb-3 font-serif text-xl">
                Quiet or closed
              </h2>
              <JourneyList items={rest} />
            </section>
          ) : null}
          {suggested.length > 1 ? (
            <p className="text-sm text-fg-muted">
              {suggested.length - 1} more possible{' '}
              {suggested.length - 1 === 1 ? 'journey' : 'journeys'} will be offered one at a time.
            </p>
          ) : null}
          <div>
            <NewJourneyForm />
          </div>
        </div>
      )}
    </>
  );
}

function JourneyList({ items }: { items: JourneyListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((j) => (
        <li key={j.id}>
          <Link
            href={`/journey/${j.id}`}
            className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
          >
            <p className="font-serif text-lg leading-snug">{j.title}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {j.member_count} {j.member_count === 1 ? 'reading' : 'readings'} · since{' '}
              <LocalTime iso={j.started_at} dateOnly />
              {j.status === 'dormant' ? ' · quiet lately' : ''}
              {j.status === 'closed' ? ' · closed' : ''}
              {j.pending_count ? ` · ${j.pending_count} to look at` : ''}
              {!j.user_confirmed ? ' · gathered automatically' : ''}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
