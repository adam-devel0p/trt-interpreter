'use client';

import * as React from 'react';
import type { SpreadLayout as Layout, SpreadPosition } from '@/domain/decks/types';
import type { DraftCard } from '@/domain/readings/draft';
import type { Orientation } from '@/domain/readings/types';
import { cn } from '../lib/cn';
import { Card, cardAltText } from './card';
import { CardPicker, type PickerCard } from './card-picker';
import { SpreadLayout } from './spread-layout';

export interface CardEntryProps {
  spreadName: string;
  positions: readonly SpreadPosition[];
  layout: Layout;
  /** The active deck's 78 cards. */
  cards: readonly PickerCard[];
  deckName: string;
  recentIds?: readonly string[];
  placed: readonly (DraftCard | null)[];
  usesReversals: boolean;
  onPlace: (index: number, cardId: string) => void;
  onRemove: (index: number) => void;
  onToggle: (index: number) => void;
  onSwap: (a: number, b: number) => void;
  className?: string;
}

/**
 * Physical-deck entry (§6.2 step 20, §19 "under a minute"): the spread with the active slot
 * highlighted, the picker focused underneath, and one row per position with orientation,
 * reorder and remove controls. Picking fills the active slot and moves to the next empty one,
 * so a three-card reading is three searches and three Enters. Orientation is a labelled
 * toggle (`aria-pressed`), shown only when the reading uses reversals — never for Thoth.
 */
export function CardEntry({
  spreadName,
  positions,
  layout,
  cards,
  deckName,
  recentIds = [],
  placed,
  usesReversals,
  onPlace,
  onRemove,
  onToggle,
  onSwap,
  className,
}: CardEntryProps) {
  const byId = React.useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const firstEmpty = placed.findIndex((c) => c === null);
  const [active, setActive] = React.useState(firstEmpty === -1 ? 0 : firstEmpty);
  const activePos = positions[active];
  const disabledIds = React.useMemo(() => placed.flatMap((c) => (c ? [c.card_id] : [])), [placed]);

  const pick = (card: PickerCard) => {
    onPlace(active, card.id);
    const next = nextEmpty(placed, active);
    if (next !== null) setActive(next);
  };

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <SpreadLayout
        name={spreadName}
        positions={positions}
        layout={layout}
        activeIndex={active}
        onSelect={setActive}
        legend={false}
        renderSlot={(_pos, index) => {
          const c = placed[index];
          const view = c ? byId.get(c.card_id) : undefined;
          return view ? <Card card={view} orientation={c!.orientation} size="sm" /> : null;
        }}
      />

      <ol
        className="divide-y divide-hairline rounded-card bg-surface hairline"
        aria-label="Positions"
      >
        {positions.map((pos, i) => {
          const c = placed[i];
          const view = c ? byId.get(c.card_id) : undefined;
          const isActive = i === active;
          return (
            <li
              key={pos.key}
              className={cn('flex items-center gap-3 px-3 py-2', isActive && 'bg-surface-2')}
            >
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={isActive}
                aria-label={`Position ${i + 1}: ${pos.name}${view ? `, ${cardAltText(view, c!.orientation)}` : ', empty'}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="w-5 shrink-0 text-right text-sm font-medium text-fg-muted tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-fg-muted">
                    {pos.name}
                    {view && c!.orientation === 'reversed' ? ' · reversed' : ''}
                  </span>
                  <span className="block truncate text-sm font-medium">
                    {view ? view.name : 'Choose a card'}
                  </span>
                </span>
              </button>
              {view ? (
                <div className="flex shrink-0 items-center gap-1">
                  {usesReversals ? (
                    <button
                      type="button"
                      onClick={() => onToggle(i)}
                      aria-pressed={c!.orientation === 'reversed'}
                      aria-label={`Reversed: ${view.name}`}
                      className={cn(
                        'min-h-9 rounded-chip px-2.5 text-xs font-medium transition-colors',
                        c!.orientation === 'reversed'
                          ? 'bg-accent text-on-accent'
                          : 'bg-surface text-fg-muted hairline hover:bg-surface-2',
                      )}
                    >
                      Reversed
                    </button>
                  ) : null}
                  <IconButton
                    label={`Move ${view.name} up`}
                    disabled={i === 0}
                    onClick={() => onSwap(i, i - 1)}
                    glyph="M12 5v14M5 12l7-7 7 7"
                  />
                  <IconButton
                    label={`Move ${view.name} down`}
                    disabled={i === positions.length - 1}
                    onClick={() => onSwap(i, i + 1)}
                    glyph="M12 5v14M5 12l7 7 7-7"
                  />
                  <IconButton
                    label={`Remove ${view.name}`}
                    onClick={() => {
                      onRemove(i);
                      setActive(i);
                    }}
                    glyph="M6 6l12 12M18 6L6 18"
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <CardPicker
        cards={cards}
        deckName={deckName}
        recentIds={recentIds}
        disabledIds={disabledIds}
        onPick={pick}
        autoFocus
        label={activePos ? `Card for position ${active + 1}: ${activePos.name}` : 'Find a card'}
      />
    </div>
  );
}

function nextEmpty(placed: readonly (DraftCard | null)[], justFilled: number): number | null {
  for (let k = 1; k <= placed.length; k++) {
    const i = (justFilled + k) % placed.length;
    if (i !== justFilled && placed[i] === null) return i;
  }
  return null;
}

function IconButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={glyph} />
      </svg>
    </button>
  );
}

export type { Orientation };
