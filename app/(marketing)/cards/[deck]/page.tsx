import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { clientEnv } from '@/config/env';
import { createAnonClient } from '@/db/client';
import { getDeckBySlug, listCards } from '@/db/queries/decks';
import { DeckBrowser } from '@/ui/components/deck-browser';
import { JsonLd, MarketingShell } from '../../_components/shell';

export const revalidate = 3600;

type Params = Promise<{ deck: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { deck: slug } = await params;
  const deck = await getDeckBySlug(createAnonClient(), slug);
  if (!deck) return { title: 'Deck' };
  return {
    title: `${deck.name} tarot card meanings`,
    description: `All 78 cards of the ${deck.name} deck with meanings, keywords and correspondences, in the deck’s own names and court structure.`,
    alternates: { canonical: `/cards/${deck.slug}` },
  };
}

export default async function DeckPage({ params }: { params: Params }) {
  const { deck: slug } = await params;
  const client = createAnonClient();
  const deck = await getDeckBySlug(client, slug);
  if (!deck) notFound();
  const cards = await listCards(client, deck);
  const site = clientEnv().NEXT_PUBLIC_SITE_URL;
  return (
    <MarketingShell
      funnel={`Drawing with a physical ${deck.name} deck? Log the cards in a few taps and keep the reading.`}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: `${deck.name} tarot card meanings`,
          url: `${site}/cards/${deck.slug}`,
          isPartOf: { '@type': 'WebPage', url: `${site}/cards` },
        }}
      />
      <div data-deck={deck.system}>
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Card meanings</p>
        <h1 className="mt-1 font-serif text-3xl leading-tight font-medium tracking-tight">
          {deck.name}
        </h1>
        <p className="prose-content mt-3 max-w-prose text-fg-muted">{deck.tradition_notes}</p>
        <div className="mt-6">
          <DeckBrowser cards={cards} deckName={deck.name} hrefBase={`/cards/${deck.slug}`} />
        </div>
      </div>
    </MarketingShell>
  );
}
