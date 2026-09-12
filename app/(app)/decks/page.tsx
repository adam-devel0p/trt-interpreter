import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionClient, requireUser } from '@/auth/session';
import { getDeckBySlug, listCards, listDecks } from '@/db/queries/decks';
import { getProfile } from '@/db/queries/profile';
import { DeckBrowser } from '@/ui/components/deck-browser';
import { PageHeader } from '@/ui/components/page-header';
import { cn } from '@/ui/lib/cn';

export const metadata = { title: 'Decks' };
export const dynamic = 'force-dynamic';

/**
 * In-app reference browser (§17): deck switcher, card grid, no AI. The default tab is the
 * profile's default deck; the switch is a link so it works without JavaScript and is
 * shareable. Card names come straight from `cards` rows.
 */
export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const user = await requireUser();
  const client = await getSessionClient();
  const [{ deck: param }, decks, profile] = await Promise.all([
    searchParams,
    listDecks(client),
    getProfile(client, user.id),
  ]);
  const fallback = decks.find((d) => d.id === profile?.default_deck_id) ?? decks[0];
  const deck = param ? await getDeckBySlug(client, param) : fallback;
  if (!deck) notFound();
  const cards = await listCards(client, deck);

  return (
    <div data-deck={deck.system}>
      <PageHeader
        title="Decks"
        description="Reference for both systems, in their own words. Nothing here is generated."
      />
      <nav aria-label="Deck" className="mb-5 flex gap-2">
        {decks.map((d) => {
          const active = d.id === deck.id;
          return (
            <Link
              key={d.id}
              href={`/decks?deck=${d.slug}`}
              aria-current={active ? 'page' : undefined}
              data-deck={d.system}
              className={cn(
                'min-h-11 flex-1 rounded-control px-3 text-center text-sm leading-[2.75rem] font-medium transition-colors',
                active
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface text-fg hairline hover:bg-surface-2',
              )}
            >
              {d.name}
            </Link>
          );
        })}
      </nav>
      <p className="mb-5 text-sm text-fg-muted">{deck.tradition_notes}</p>
      <DeckBrowser cards={cards} deckName={deck.name} hrefBase={`/decks/${deck.slug}`} />
    </div>
  );
}
