import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clientEnv } from '@/config/env';
import { createAnonClient } from '@/db/client';
import { getCardBySlug, getDeckBySlug, neighbourCards } from '@/db/queries/decks';
import { CardDetail } from '@/ui/components/card-detail';
import { JsonLd, MarketingShell } from '../../../_components/shell';

export const revalidate = 3600;

type Params = Promise<{ deck: string; slug: string }>;

async function load(params: Params) {
  const { deck: deckSlug, slug } = await params;
  const client = createAnonClient();
  const deck = await getDeckBySlug(client, deckSlug);
  if (!deck) return null;
  const card = await getCardBySlug(client, deck, slug);
  if (!card) return null;
  return { client, deck, card };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { title: 'Card' };
  const { deck, card } = data;
  const title = card.title
    ? `${card.name} (${card.title}) — ${deck.name} tarot card meaning`
    : `${card.name} — ${deck.name} tarot card meaning`;
  const description = `${card.keywords_upright.slice(0, 4).join(', ')}. ${card.meaning_upright.split(/(?<=\.)\s/)[0]}`;
  return {
    title,
    description,
    alternates: { canonical: `/cards/${deck.slug}/${card.slug}` },
    openGraph: {
      title,
      description,
      type: 'article',
      images: card.art_asset_path
        ? [{ url: `${card.art_asset_path}-640.webp`, width: 640, height: 1067 }]
        : undefined,
    },
  };
}

/**
 * Public card reference (§15.1 SEO). Server-rendered for anonymous visitors through the anon
 * client (reference tables are readable by `anon`). One funnel line, nothing more.
 */
export default async function PublicCardPage({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  const { client, deck, card } = data;
  const neighbours = await neighbourCards(client, deck, card.sort_order);
  const site = clientEnv().NEXT_PUBLIC_SITE_URL;
  return (
    <MarketingShell
      funnel={`Pulled ${card.name} recently? Save the reading and see what it turns out to have pointed at.`}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: `${card.name} — ${deck.name}`,
          description: card.meaning_upright,
          url: `${site}/cards/${deck.slug}/${card.slug}`,
          image: card.art_asset_path ? `${site}${card.art_asset_path}-640.webp` : undefined,
          about: { '@type': 'Thing', name: card.name, alternateName: card.title ?? undefined },
          isPartOf: {
            '@type': 'CollectionPage',
            name: `${deck.name} tarot card meanings`,
            url: `${site}/cards/${deck.slug}`,
          },
          keywords: card.keywords_upright.join(', '),
        }}
      />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-muted">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/cards" className="underline underline-offset-4">
              Cards
            </Link>
            <span aria-hidden="true"> / </span>
          </li>
          <li>
            <Link href={`/cards/${deck.slug}`} className="underline underline-offset-4">
              {deck.name}
            </Link>
            <span aria-hidden="true"> / </span>
          </li>
          <li aria-current="page">{card.name}</li>
        </ol>
      </nav>
      <CardDetail card={card} neighbours={neighbours} hrefFor={(s) => `/cards/${deck.slug}/${s}`} />
    </MarketingShell>
  );
}
