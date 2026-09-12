import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionClient } from '@/auth/session';
import { getCardBySlug, getDeckBySlug, neighbourCards } from '@/db/queries/decks';
import { CardDetail } from '@/ui/components/card-detail';

export const dynamic = 'force-dynamic';

type Params = Promise<{ deck: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { deck: deckSlug, slug } = await params;
  const client = await getSessionClient();
  const deck = await getDeckBySlug(client, deckSlug);
  const card = deck ? await getCardBySlug(client, deck, slug) : null;
  return { title: card ? `${card.name} · ${deck!.name}` : 'Card' };
}

/** In-app card reference. Purely `cards`-row data; no AI, no archetype lookup. */
export default async function CardPage({ params }: { params: Params }) {
  const { deck: deckSlug, slug } = await params;
  const client = await getSessionClient();
  const deck = await getDeckBySlug(client, deckSlug);
  if (!deck) notFound();
  const card = await getCardBySlug(client, deck, slug);
  if (!card) notFound();
  const neighbours = await neighbourCards(client, deck, card.sort_order);
  return (
    <>
      <p className="pt-4 text-sm">
        <Link
          href={`/decks?deck=${deck.slug}`}
          className="text-accent underline underline-offset-4"
        >
          ← {deck.name}
        </Link>
      </p>
      <div className="pt-4">
        <CardDetail
          card={card}
          neighbours={neighbours}
          hrefFor={(s) => `/decks/${deck.slug}/${s}`}
        />
      </div>
    </>
  );
}
