import { createAnonClient } from '@/db/client';
import { listCards, listDecks, listSpreads } from '@/db/queries/decks';
import { PageHeader } from '@/ui/components/page-header';
import { DeckGallery, type DeckGalleryProps } from './deck-gallery';
import { Gallery } from './gallery';

export const metadata = { title: 'UI gallery' };
export const dynamic = 'force-dynamic';

export default async function DevUiPage() {
  // Reference tables are anon-readable; the gallery shows real rows, not fixtures.
  const client = createAnonClient();
  const decks = await listDecks(client);
  const withCards: DeckGalleryProps['decks'] = await Promise.all(
    decks.map(async (d) => ({ system: d.system, name: d.name, cards: await listCards(client, d) })),
  );
  const spreads = await listSpreads(client);
  return (
    <>
      <PageHeader
        title="Component gallery"
        eyebrow="dev only"
        description="Every base component, in both themes and both deck accents. Designed at 390px."
      />
      <Gallery deckSections={<DeckGallery decks={withCards} spreads={spreads} />} />
    </>
  );
}
