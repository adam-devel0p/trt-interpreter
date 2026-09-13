import Link from 'next/link';
import * as React from 'react';
import type { MonthGroup } from '@/domain/journal/filters';
import type { TimelineEntry } from '@/domain/journeys/timeline';
import { FOLLOW_UP_LABEL } from '@/domain/readings/types';
import { cn } from '../lib/cn';
import { LocalTime } from './local-time';

/**
 * The journey timeline (spec §6.5): a semantic list of month sections, each item an entry
 * of the interleaved union (readings now; events and outcomes render from the same union in
 * Phase 08). Every card is shown under its own deck's name and accent (§6.7) — there is no
 * mapping step between the stored row and this markup. `renderExtra` lets the page attach
 * per-item controls (a client island) without the timeline knowing about actions.
 */
export function JourneyTimeline({
  groups,
  renderExtra,
  className,
}: {
  groups: MonthGroup<TimelineEntry>[];
  renderExtra?: (entry: TimelineEntry) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-6', className)} data-testid="journey-timeline">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`month-${g.key}`}>
          <h3
            id={`month-${g.key}`}
            className="sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase backdrop-blur"
          >
            {g.label}
          </h3>
          <ol className="mt-1 flex flex-col gap-2">
            {g.items.map((e) => (
              <li key={`${e.kind}-${e.id}`} data-kind={e.kind}>
                {e.kind === 'reading' ? (
                  <ReadingEntry entry={e} extra={renderExtra?.(e)} />
                ) : (
                  <OtherEntry entry={e} />
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function ReadingEntry({
  entry,
  extra,
}: {
  entry: Extract<TimelineEntry, { kind: 'reading' }>;
  extra?: React.ReactNode;
}) {
  const title = entry.isOpenReflection ? 'Open reflection' : (entry.question ?? 'Reading');
  return (
    <article
      data-deck={entry.deck.system}
      className="rounded-card border-l-2 border-accent bg-surface px-4 py-3 hairline"
    >
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
        <LocalTime iso={entry.at} dateOnly />
        <span className="tracking-normal normal-case">
          {' '}
          · {entry.spread} · {entry.deck.name}
        </span>
      </p>
      <Link
        href={`/reading/${entry.id}`}
        className="mt-1 block font-serif text-lg leading-snug hover:underline"
      >
        {title}
      </Link>
      <p className="mt-1 text-sm text-fg-muted" aria-label={`Cards from ${entry.deck.name}`}>
        {entry.cards.map((c, i) => (
          <React.Fragment key={`${c.cardId}-${i}`}>
            {i > 0 ? ' · ' : ''}
            {c.name}
            {c.orientation === 'reversed' ? ' (reversed)' : ''}
          </React.Fragment>
        ))}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className={cn(
            'rounded-chip px-2 py-0.5 hairline',
            entry.followUpStatus === 'unresolved' ? 'bg-accent-soft' : 'bg-surface',
          )}
        >
          {FOLLOW_UP_LABEL[entry.followUpStatus as keyof typeof FOLLOW_UP_LABEL] ??
            entry.followUpStatus}
        </span>
        <span className="text-fg-muted">
          {entry.membership.state === 'confirmed'
            ? 'here because you said so'
            : 'gathered here — suggested'}
        </span>
        {extra}
      </div>
    </article>
  );
}

function OtherEntry({ entry }: { entry: Extract<TimelineEntry, { kind: 'event' | 'outcome' }> }) {
  return (
    <article className="rounded-card border-l-2 border-hairline-strong bg-surface px-4 py-3 hairline">
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
        <LocalTime iso={entry.at} dateOnly />
        <span className="tracking-normal normal-case">
          {' '}
          · {entry.kind === 'event' ? 'life event' : 'outcome'}
        </span>
      </p>
      <p className="mt-1 font-serif text-lg leading-snug">{entry.description}</p>
    </article>
  );
}
