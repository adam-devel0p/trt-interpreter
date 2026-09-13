import Link from 'next/link';
import * as React from 'react';
import type { JournalItem } from '@/db/queries/journal';
import { FOLLOW_UP_LABEL, LIFE_AREAS } from '@/domain/readings/types';
import { cn } from '../lib/cn';
import { Card } from './card';
import { LocalTime } from './local-time';

/** Thumbnails shown before "+N more". */
export const TIMELINE_THUMBS = 5;
const PREVIEW_CHARS = 140;

export function previewText(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > PREVIEW_CHARS ? `${one.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : one;
}

/**
 * One reading on the journal timeline (FR-07). Everything here is a stored column: date,
 * question, deck accent, spread, the deck-native card names, a one-line preview — the AI
 * synthesis if one exists (labelled, in the tinted sans treatment) or the user's own note (in
 * the serif) — and the status chips. `content-visibility: auto` lets a 1000-entry list scroll
 * at 60fps: off-screen items skip layout and paint until they approach the viewport.
 */
export function TimelineItem({
  item,
  matchedCardIds,
  className,
}: {
  item: JournalItem;
  /** Cards the search matched (highlighted so a Thoth *Lust* found by "strength" is obvious). */
  matchedCardIds?: ReadonlySet<string>;
  className?: string;
}) {
  const title = item.is_open_reflection ? 'Open reflection' : (item.question ?? 'Reading');
  const lifeArea = LIFE_AREAS.find((a) => a.key === item.life_area)?.label ?? null;
  const shown = item.cards.slice(0, TIMELINE_THUMBS);
  const more = item.cards.length - shown.length;
  return (
    <li
      data-deck={item.deck.system}
      className={cn('[contain-intrinsic-size:auto_9rem] [content-visibility:auto]', className)}
    >
      <Link
        href={`/reading/${item.id}`}
        className="block rounded-card border-l-2 border-accent bg-surface px-4 py-3 hairline hover:bg-surface-2"
      >
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
          <LocalTime iso={item.occurred_at} />
          <span className="tracking-normal normal-case">
            {' '}
            · {item.spread.name} · {item.deck.name}
            {item.source === 'physical' ? ' · physical' : ''}
          </span>
        </p>
        <p className="mt-1 font-serif text-lg leading-snug text-balance">{title}</p>

        <div className="mt-2 flex items-center gap-1.5" aria-hidden="true">
          {shown.map((c) => (
            <Card
              key={c.position_index}
              card={c.card}
              orientation={c.orientation}
              size="xs"
              className={cn(
                matchedCardIds?.has(c.card.id) &&
                  'rounded-[3px] outline-2 outline-offset-2 outline-accent',
              )}
            />
          ))}
          {more > 0 ? <span className="text-xs text-fg-muted">+{more}</span> : null}
        </div>
        <p className="mt-1.5 text-sm text-fg-muted">
          {item.cards.map((c, i) => (
            <React.Fragment key={c.position_index}>
              {i > 0 ? ' · ' : ''}
              <span
                className={cn(
                  matchedCardIds?.has(c.card.id) &&
                    'font-medium text-fg underline underline-offset-2',
                )}
              >
                {c.card.name}
                {c.orientation === 'reversed' ? ' (reversed)' : ''}
              </span>
            </React.Fragment>
          ))}
        </p>

        {item.synthesis ? (
          <p className="mt-2 line-clamp-2 rounded-control border-l-2 border-hairline-strong bg-surface-ai py-1 pr-2 pl-2.5 text-sm text-fg-muted">
            <span className="font-medium text-fg">AI · </span>
            {previewText(item.synthesis)}
          </p>
        ) : item.user_notes ? (
          <p className="mt-2 line-clamp-2 font-serif text-[0.95rem] leading-snug text-fg">
            {previewText(item.user_notes)}
          </p>
        ) : null}

        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Status">
          {lifeArea ? <Chip>{lifeArea}</Chip> : null}
          <Chip emphasis={item.follow_up_status === 'unresolved'}>
            {FOLLOW_UP_LABEL[item.follow_up_status]}
          </Chip>
          {item.revisit_at ? (
            <Chip>
              Revisit <LocalTime iso={item.revisit_at} dateOnly />
            </Chip>
          ) : null}
        </ul>
      </Link>
    </li>
  );
}

function Chip({ children, emphasis = false }: { children: React.ReactNode; emphasis?: boolean }) {
  return (
    <li
      className={cn(
        'rounded-chip px-2.5 py-1 text-xs font-medium hairline',
        emphasis ? 'bg-accent-soft text-fg' : 'bg-surface text-fg-muted',
      )}
    >
      {children}
    </li>
  );
}
