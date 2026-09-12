import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clientEnv } from '@/config/env';
import { createAnonClient } from '@/db/client';
import { getBuiltinSpreadBySlug } from '@/db/queries/decks';
import { SpreadLayout } from '@/ui/components/spread-layout';
import { JsonLd, MarketingShell } from '../../_components/shell';

export const revalidate = 3600;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const spread = await getBuiltinSpreadBySlug(createAnonClient(), slug);
  if (!spread) return { title: 'Spread' };
  return {
    title: `${spread.name} tarot spread`,
    description: `${spread.description} ${spread.card_count} positions with what each one asks.`,
    alternates: { canonical: `/spreads/${spread.slug}` },
  };
}

export default async function PublicSpreadPage({ params }: { params: Params }) {
  const { slug } = await params;
  const spread = await getBuiltinSpreadBySlug(createAnonClient(), slug);
  if (!spread) notFound();
  const site = clientEnv().NEXT_PUBLIC_SITE_URL;
  return (
    <MarketingShell
      funnel={`Lay out the ${spread.name} spread with your own deck and keep every position with the reading.`}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'HowTo',
          name: `${spread.name} tarot spread`,
          description: spread.description,
          url: `${site}/spreads/${spread.slug}`,
          step: spread.positions.map((p) => ({
            '@type': 'HowToStep',
            position: p.index + 1,
            name: p.name,
            text: p.prompt,
          })),
        }}
      />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-muted">
        <Link href="/spreads" className="underline underline-offset-4">
          Spreads
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{spread.name}</span>
      </nav>
      <h1 className="font-serif text-3xl leading-tight font-medium tracking-tight">
        {spread.name}
      </h1>
      <p className="prose-content mt-3 max-w-prose text-fg-muted">{spread.description}</p>
      <div className="mx-auto mt-6 max-w-[26rem]">
        <SpreadLayout name={spread.name} positions={spread.positions} layout={spread.layout} />
      </div>
      <section aria-labelledby="positions-h" className="mt-8">
        <h2 id="positions-h" className="mb-3 font-serif text-xl">
          What each position asks
        </h2>
        <ol className="space-y-3">
          {spread.positions.map((p) => (
            <li key={p.key} className="rounded-card bg-surface p-4 hairline">
              <p className="text-sm font-medium">
                <span className="text-fg-muted tabular-nums">{p.index + 1} · </span>
                {p.name}
              </p>
              <p className="prose-content mt-1 text-[1rem]">{p.prompt}</p>
            </li>
          ))}
        </ol>
      </section>
    </MarketingShell>
  );
}
