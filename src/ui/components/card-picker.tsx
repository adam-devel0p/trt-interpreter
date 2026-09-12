'use client';

import * as React from 'react';
import { searchCards, type SearchableAlias, type SearchHit } from '@/domain/decks/search';
import type { CardView } from '@/domain/decks/types';
import { cn } from '../lib/cn';
import { Card } from './card';

export type PickerCard = CardView & { aliases: SearchableAlias[] };

type Chip = 'all' | 'major' | string; // suit keys are deck-native ('pentacles' | 'disks')

export interface CardPickerProps {
  /** The active deck's cards only — a Thoth picker never sees "Page of Pentacles". */
  cards: readonly PickerCard[];
  deckName: string;
  onPick: (card: PickerCard) => void;
  /** Most-recently / most-often used card ids, shown first while the query is empty. */
  recentIds?: readonly string[];
  /** Cards already placed; shown but not selectable. */
  disabledIds?: readonly string[];
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

const MAX_RESULTS = 12;

/**
 * The speed-critical control for physical-deck entry (§6.5): a combobox over the deck held in
 * memory, searched by name, title, number, rank, suit and alias; keyboard-first (arrows, Enter,
 * Escape); recent cards first; suit / Major filter chips. A card is reachable in ≤ 3
 * interactions: focus, type, Enter — or two taps when it is in the recent row.
 *
 * Deck scoping is by construction: whatever `cards` you pass is the whole universe.
 */
export function CardPicker({
  cards,
  deckName,
  onPick,
  recentIds = [],
  disabledIds = [],
  label = 'Find a card',
  placeholder,
  autoFocus,
  className,
}: CardPickerProps) {
  const id = React.useId();
  const listId = `${id}-list`;
  const [query, setQuery] = React.useState('');
  const [chip, setChip] = React.useState<Chip>('all');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  // Suit chips come from the deck itself, so labels are deck-native (Disks vs Pentacles).
  const suits = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of cards)
      if (c.suit && c.suit_label && !seen.has(c.suit)) seen.set(c.suit, c.suit_label);
    return [...seen.entries()];
  }, [cards]);

  const matchesChip = React.useCallback(
    (c: PickerCard) =>
      chip === 'all' || (chip === 'major' ? c.arcana === 'major' : c.suit === chip),
    [chip],
  );

  const results: SearchHit<PickerCard>[] = React.useMemo(() => {
    const q = query.trim();
    if (q)
      return searchCards(cards, q, { limit: 78 })
        .filter((h) => matchesChip(h.card))
        .slice(0, MAX_RESULTS);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const recent = recentIds
      .map((r) => byId.get(r))
      .filter((c): c is PickerCard => !!c && matchesChip(c));
    const rest = cards.filter((c) => matchesChip(c) && !recent.includes(c));
    return [...recent, ...rest]
      .slice(0, chip === 'all' && recent.length ? MAX_RESULTS : 78)
      .map((card) => ({
        card,
        score: 0,
        matched: 'name' as const,
      }));
  }, [cards, query, chip, recentIds, matchesChip]);

  React.useEffect(() => setActive(0), [query, chip]);

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const disabled = React.useMemo(() => new Set(disabledIds), [disabledIds]);

  const pick = (hit: SearchHit<PickerCard> | undefined) => {
    if (!hit || disabled.has(hit.card.id)) return;
    onPick(hit.card);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        if (results.length) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (results.length) {
          e.preventDefault();
          setActive(results.length - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        pick(results[active]);
        break;
      case 'Escape':
        if (query) {
          e.preventDefault();
          setQuery('');
        }
        break;
    }
  };

  const activeId = results[active] ? `${id}-opt-${results[active].card.id}` : undefined;
  const recentSet = new Set(recentIds);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div>
        <label htmlFor={`${id}-input`} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          autoFocus={autoFocus}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby={`${id}-hint`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? `Name, number or suit — ${deckName}`}
          className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline placeholder:text-fg-faint"
        />
        <p id={`${id}-hint`} className="sr-only">
          Type to search. Use the up and down arrows to move through results and Enter to choose.
        </p>
      </div>

      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
        {([['all', 'All'], ['major', 'Major'], ...suits] as [Chip, string][]).map(([key, text]) => (
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
        ))}
      </div>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={`Cards in ${deckName}`}
        className="max-h-[22rem] divide-y divide-hairline overflow-y-auto rounded-card bg-surface hairline"
      >
        {results.length === 0 ? (
          <li
            role="option"
            aria-selected={false}
            aria-disabled="true"
            className="px-3 py-4 text-sm text-fg-muted"
          >
            No card in {deckName} matches “{query}”. Try a number, a suit, or another spelling.
          </li>
        ) : (
          results.map((hit, i) => {
            const c = hit.card;
            const isActive = i === active;
            const isDisabled = disabled.has(c.id);
            return (
              <li
                key={c.id}
                id={`${id}-opt-${c.id}`}
                role="option"
                data-index={i}
                aria-selected={isActive}
                aria-disabled={isDisabled || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
                onMouseMove={() => setActive(i)}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2',
                  isActive && 'bg-surface-2',
                  isDisabled && 'cursor-default opacity-50',
                )}
              >
                <Card card={c} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {c.title ? <span className="italic">{c.title} · </span> : null}
                    {c.arcana === 'major' ? `Major ${c.numeral}` : `${c.suit_label}`}
                    {hit.matched === 'alias' && hit.via ? <span> · also “{hit.via}”</span> : null}
                    {!query && recentSet.has(c.id) ? <span> · recent</span> : null}
                    {isDisabled ? <span> · already placed</span> : null}
                  </p>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <p className="sr-only" aria-live="polite">
        {results.length === 0 ? 'No results' : `${results.length} results`}
      </p>
    </div>
  );
}
