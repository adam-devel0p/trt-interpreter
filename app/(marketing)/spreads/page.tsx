import type { Metadata } from 'next';
import Link from 'next/link';
import { clientEnv } from '@/config/env';
import { createAnonClient } from '@/db/client';
import { listSpreads } from '@/db/queries/decks';
import { SpreadLayout } from '@/ui/components/spread-layout';
import { JsonLd, MarketingShell } from '../_components/shell';

// On demand, not at build time: the build must not depend on a reachable database.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tarot spreads',
  description:
    'Five tarot spreads with position meanings and layouts: one card, past–present–future, situation–advice–outcome, a two-path decision spread and a short Celtic cross.',
  alternates: { canonical: '/spreads' },
};

export default async function SpreadsIndexPage() {
  const spreads = await listSpreads(createAnonClient());
  const site = clientEnv().NEXT_PUBLIC_SITE_URL;
  return (
    <MarketingShell funnel="Every spread here is built in. Lay the cards, log them, and the positions come with the reading.">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Tarot spreads',
          url: `${site}/spreads`,
          hasPart: spreads.map((s) => ({
            '@type': 'WebPage',
            name: s.name,
            url: `${site}/spreads/${s.slug}`,
          })),
        }}
      />
      <h1 className="font-serif text-3xl leading-tight font-medium tracking-tight">Spreads</h1>
      <p className="prose-content mt-3 max-w-prose text-fg-muted">
        A spread gives each card a job. These five cover most questions without asking for ten
        cards.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {spreads.map((s) => (
          <li key={s.id}>
            <Link
              href={`/spreads/${s.slug}`}
              className="flex h-full flex-col gap-3 rounded-card bg-surface p-4 hairline transition-colors hover:bg-surface-2"
            >
              <div className="mx-auto w-full max-w-[14rem]">
                <SpreadLayout
                  name={s.name}
                  positions={s.positions}
                  layout={s.layout}
                  legend={false}
                />
              </div>
              <span className="font-serif text-lg">{s.name}</span>
              <span className="text-sm text-fg-muted">
                {s.card_count} {s.card_count === 1 ? 'card' : 'cards'} · {s.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </MarketingShell>
  );
}
