import type { Metadata } from 'next';
import Link from 'next/link';
import { clientEnv } from '@/config/env';
import { createAnonClient } from '@/db/client';
import { listDecks } from '@/db/queries/decks';
import { JsonLd, MarketingShell } from '../_components/shell';

// On demand, not at build time: the build must not depend on a reachable database.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tarot card meanings — Rider–Waite–Smith and Thoth',
  description:
    'Reference meanings for all 156 cards of the Rider–Waite–Smith and Thoth decks, each in its own system: names, titles, court structure and correspondences as the deck uses them.',
  alternates: { canonical: '/cards' },
};

export default async function CardsIndexPage() {
  const decks = await listDecks(createAnonClient());
  const site = clientEnv().NEXT_PUBLIC_SITE_URL;
  return (
    <MarketingShell funnel="Meanings are a starting point. What a card meant for you shows up over time — that is what a journal is for.">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Tarot card meanings',
          url: `${site}/cards`,
          hasPart: decks.map((d) => ({
            '@type': 'WebPage',
            name: d.name,
            url: `${site}/cards/${d.slug}`,
          })),
        }}
      />
      <h1 className="font-serif text-3xl leading-tight font-medium tracking-tight">
        Card meanings
      </h1>
      <p className="prose-content mt-3 max-w-prose text-fg-muted">
        Two deck systems, each described in its own terms. Rider–Waite–Smith and Thoth share a
        structure but not a vocabulary: the Thoth deck’s Adjustment, Lust, Art, The Aeon and The
        Universe are not renamed Rider–Waite cards, and its court of Knight, Queen, Prince and
        Princess is its own.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {decks.map((d) => (
          <li key={d.id} data-deck={d.system}>
            <Link
              href={`/cards/${d.slug}`}
              className="block h-full rounded-card border-l-4 border-accent bg-surface p-5 hairline transition-colors hover:bg-surface-2"
            >
              <span className="block font-serif text-xl">{d.name}</span>
              <span className="mt-2 block text-sm text-fg-muted">{d.tradition_notes}</span>
            </Link>
          </li>
        ))}
      </ul>
    </MarketingShell>
  );
}
