'use client';

import Link from 'next/link';
import * as React from 'react';
import { searchCards } from '@/domain/decks/search';
import type { CardView } from '@/domain/decks/types';
import { cn } from '../lib/cn';
import { Card } from './card';

type BrowserCard = CardView & {
  aliases: { alias: string; kind: 'search' | 'cross_deck' | 'historical' }[];
};

/**
 * Card grid for one deck with in-memory search and suit / Major filter. Each tile links to
 * the card's reference page under `hrefBase` so the in-app and public routes share the grid.
 */
export function DeckBrowser({
  cards,
  deckName,
  hrefBase,
}: {
  cards: BrowserCard[];
  deckName: string;
  hrefBase: string;
}) {
  const id = React.useId();
  const [query, setQuery] = React.useState('');
  const [chip, setChip] = React.useState<'all' | 'major' | string>('all');

  const suits = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of cards)
      if (c.suit && c.suit_label && !seen.has(c.suit)) seen.set(c.suit, c.suit_label);
    return [...seen.entries()];
  }, [cards]);

  const inChip = (c: BrowserCard) =>
    chip === 'all' || (chip === 'major' ? c.arcana === 'major' : c.suit === chip);
  const hits = query.trim()
    ? searchCards(cards, query, { limit: 78 }).filter((h) => inChip(h.card))
    : cards
        .filter(inChip)
        .map((card) => ({ card, matched: 'name' as const, via: undefined as string | undefined }));

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <label htmlFor={`${id}-q`} className="sr-only">
            Search {deckName}
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${deckName} — name, number, suit, or another deck’s name`}
            className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline placeholder:text-fg-faint"
          />
        </div>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['major', 'Major'], ...suits] as [string, string][]).map(
            ([key, text]) => (
              <button
                key={key}
                type="button"
                aria-pressed={chip === key}
                onClick={() => setChip(key)}
                className={cn(
                  'min-h-9 rounded-chip px-3 text-sm font-medium transition-colors',
                  chip === key
                    ? 'bg-accent text-on-accent'
                    : 'bg-surface text-fg-muted hairline hover:bg-surface-2',
                )}
              >
                {text}
              </button>
            ),
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {hits.length} cards
      </p>
      {hits.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-sm text-fg-muted hairline">
          No card in {deckName} matches “{query}”. Try a number, a suit, or another spelling.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
          {hits.map(({ card, matched, via }) => (
            <li key={card.id}>
              <Link
                href={`${hrefBase}/${card.slug}`}
                className="group flex flex-col items-center gap-1.5 rounded-card outline-offset-4"
              >
                <Card
                  card={card}
                  size="sm"
                  className="w-full max-w-[6.5rem] transition-transform group-hover:-translate-y-0.5"
                />
                <span className="w-full text-center text-xs leading-tight">
                  <span className="block font-medium">{card.name}</span>
                  {card.title ? (
                    <span className="block text-fg-muted italic">{card.title}</span>
                  ) : null}
                  {matched === 'alias' && via ? (
                    <span className="block text-fg-faint">also “{via}”</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
