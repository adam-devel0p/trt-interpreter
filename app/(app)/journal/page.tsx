import Link from 'next/link';
import { FIRST_READING_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { listDecks, listSpreads } from '@/db/queries/decks';
import { listEntities } from '@/db/queries/memory';
import { countReadings, searchJournal } from '@/db/queries/journal';
import { hasActiveFilters, parseJournalParams } from '@/domain/journal/filters';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';
import { JournalFilters } from './filters';
import { JournalList } from './journal-list';

export const metadata = { title: 'Journal' };
export const dynamic = 'force-dynamic';

/**
 * Journal (§5, FR-07, FR-21): the timeline, filters and search. The URL is the state, so a
 * filtered view is shareable and the browser back button works. Every row comes from stored
 * columns in one query — nothing on this route reaches a model, ever.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  await requireUser();
  const client = await getSessionClient();
  const filters = parseJournalParams(raw);
  const [page, decks, spreads, entities, total] = await Promise.all([
    searchJournal(client, filters),
    listDecks(client),
    listSpreads(client),
    listEntities(client),
    countReadings(client),
  ]);
  const active = hasActiveFilters(filters);
  const rawParams = Object.fromEntries(
    Object.entries(raw).flatMap(([k, v]) =>
      typeof v === 'string' ? [[k, v]] : v ? [[k, v[0]!]] : [],
    ),
  );

  return (
    <>
      <PageHeader title="Journal" />
      {total === 0 ? (
        <EmptyState
          title="Your readings will collect here"
          description="The first one is the start of your timeline."
          action={
            <Button asChild>
              <Link href={FIRST_READING_PATH}>Start a reading</Link>
            </Button>
          }
        />
      ) : (
        <>
          <JournalFilters
            filters={filters}
            decks={decks.map((d) => ({ slug: d.slug, name: d.name }))}
            spreads={spreads.map((s) => ({ id: s.id, name: s.name }))}
            entities={entities.map((e) => ({ id: e.id, name: e.canonical_label }))}
          />
          <JournalList
            key={JSON.stringify(rawParams)}
            initial={page}
            rawParams={rawParams}
            active={active}
          />
        </>
      )}
    </>
  );
}
