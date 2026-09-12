import Link from 'next/link';
import * as React from 'react';
import { ELEMENT_SIGIL } from '@/domain/decks/glyphs';
import type { CardDetail as CardDetailData } from '@/db/queries/decks';
import { Card } from './card';

/**
 * Reference view of one card (§17 MVP reference layer): deck-native name, title, meanings,
 * correspondences, symbolism. No AI, nothing inferred. Used by /decks (in-app) and the public
 * /cards pages. `hrefFor` builds the neighbour links so both routes can share it.
 */
export function CardDetail({
  card,
  neighbours,
  hrefFor,
}: {
  card: CardDetailData;
  neighbours: {
    prev: { slug: string; name: string } | null;
    next: { slug: string; name: string } | null;
  };
  hrefFor: (slug: string) => string;
}) {
  const k = card.correspondences;
  const facts: [string, React.ReactNode][] = [];
  if (card.arcana === 'major') facts.push(['Number', `${card.numeral} · ${card.number}`]);
  if (card.suit_label) facts.push(['Suit', card.suit_label]);
  if (card.rank_label) facts.push(['Rank', card.rank_label]);
  if (card.element) facts.push(['Element', ELEMENT_SIGIL[card.element].label]);
  if (k.sub_element) facts.push(['Sub-element', k.sub_element]);
  if (card.astrology) facts.push(['Astrology', card.astrology]);
  if (k.decan) facts.push(['Decan', k.decan]);
  if (k.rulership) facts.push(['Rules', k.rulership]);
  if (k.sephira) facts.push(['Sephira', k.sephira]);
  if (k.path) facts.push(['Path', String(k.path)]);
  if (k.hebrew_letter)
    facts.push([
      'Hebrew letter',
      `${k.hebrew_letter}${k.hebrew_letter_meaning ? ` (${k.hebrew_letter_meaning})` : ''}`,
    ]);
  if (k.esoteric_title) facts.push(['Esoteric title', k.esoteric_title]);
  if (k.notes) facts.push(['Note', k.notes]);

  const alsoKnown = card.aliases.filter((a) => a.kind !== 'search').map((a) => a.alias);

  return (
    <article data-deck={card.deck_system} className="pb-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <Card card={card} size="lg" priority className="shrink-0" />
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {card.deck_name} ·{' '}
            {card.arcana === 'major' ? `Major Arcana ${card.numeral}` : card.suit_label}
          </p>
          <h1 className="mt-1 font-serif text-[2rem] leading-tight font-medium tracking-tight">
            {card.name}
          </h1>
          {card.title ? (
            <p className="mt-1 font-serif text-lg text-accent italic">{card.title}</p>
          ) : null}
          <ul
            className="mt-4 flex flex-wrap justify-center gap-1.5 sm:justify-start"
            aria-label="Keywords"
          >
            {card.keywords_upright.map((kw) => (
              <li
                key={kw}
                className="rounded-chip bg-accent-soft px-2.5 py-1 text-xs font-medium text-fg"
              >
                {kw}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section aria-labelledby="meaning-h" className="mt-8">
        <h2 id="meaning-h" className="mb-2 font-serif text-xl">
          {card.deck_supports_reversals ? 'Upright' : 'Meaning'}
        </h2>
        <p className="prose-content">{card.meaning_upright}</p>
      </section>

      <section aria-labelledby="reversed-h" className="mt-6">
        <h2 id="reversed-h" className="mb-2 font-serif text-xl">
          Reversed
        </h2>
        {card.meaning_reversed ? (
          <>
            <p className="prose-content">{card.meaning_reversed}</p>
            {card.keywords_reversed.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Reversed keywords">
                {card.keywords_reversed.map((kw) => (
                  <li
                    key={kw}
                    className="rounded-chip bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted"
                  >
                    {kw}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {card.deck_name} is read by elemental dignity and position rather than by reversal, so
            this card carries no reversed meaning. Neighbouring cards and the question colour it
            instead.
          </p>
        )}
      </section>

      <section aria-labelledby="symbolism-h" className="mt-6">
        <h2 id="symbolism-h" className="mb-2 font-serif text-xl">
          On the card
        </h2>
        <p className="prose-content">{card.symbolism}</p>
      </section>

      <section aria-labelledby="corr-h" className="mt-6">
        <h2 id="corr-h" className="mb-2 font-serif text-xl">
          Correspondences
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-card bg-surface p-4 text-sm hairline">
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-fg-muted">{label}</dt>
              <dd className="capitalize-none min-w-0">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
        {alsoKnown.length ? (
          <p className="mt-3 text-sm text-fg-muted">
            Found by searching: {alsoKnown.join(', ')}. Those are other decks’ names for this
            position; the card is always shown as {card.name}.
          </p>
        ) : null}
      </section>

      <nav aria-label="Neighbouring cards" className="mt-8 flex justify-between gap-4 text-sm">
        {neighbours.prev ? (
          <Link
            href={hrefFor(neighbours.prev.slug)}
            className="text-accent underline underline-offset-4"
          >
            ← {neighbours.prev.name}
          </Link>
        ) : (
          <span />
        )}
        {neighbours.next ? (
          <Link
            href={hrefFor(neighbours.next.slug)}
            className="text-right text-accent underline underline-offset-4"
          >
            {neighbours.next.name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
