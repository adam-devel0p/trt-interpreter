import Link from 'next/link';
import * as React from 'react';
import { occurrencesSentence, type RecurringSymbol } from '@/domain/journeys/symbols';

/**
 * Recurring symbols (spec §3.3 "not merely statistics"): each with when it appeared (one
 * sparse timeline of occurrences — the section's single visual, with a text equivalent),
 * around which journeys, before or after which confirmed events, whether the user
 * confirmed a connection, and its source readings. A card carries its own deck's name
 * (§6.7): Thoth *Lust* and RWS *Strength* are two rows if both recur, never one. A symbol
 * is labelled a pattern only from three readings; two appearances say "twice".
 */
export function RecurringSymbols({
  symbols,
  titles,
  span,
}: {
  symbols: RecurringSymbol[];
  /** Reading id → title, for the source list. */
  titles: Map<string, string>;
  /** Timeline bounds; defaults to the symbols' own span. */
  span?: { start: string; end: string };
}) {
  if (symbols.length === 0) return null;
  const all = symbols.flatMap((s) => s.occurrences.map((o) => o.at)).sort();
  const start = Date.parse(span?.start ?? all[0]!);
  const end = Math.max(Date.parse(span?.end ?? all[all.length - 1]!), start + 86_400_000);
  return (
    <ul className="flex flex-col gap-2" data-testid="recurring-symbols">
      {symbols.map((s) => (
        <li
          key={s.key}
          data-symbol-kind={s.kind}
          data-deck={s.deck?.system}
          data-pattern={s.isPattern ? 'true' : 'false'}
        >
          <details className="group rounded-card bg-surface hairline">
            <summary className="flex min-h-11 cursor-pointer list-none items-baseline gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-fg-muted">
                {s.kind === 'theme' ? 'theme' : s.deck ? `${s.kind} · ${s.deck.name}` : s.kind}
                {' · '}
                {s.isPattern
                  ? `pattern · ${s.occurrences.length} times`
                  : s.occurrences.length === 2
                    ? 'twice'
                    : `${s.occurrences.length} times`}
              </span>
              <span
                aria-hidden="true"
                className="ml-auto text-fg-muted transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="border-t border-hairline px-3 py-2 text-sm">
              <p className="text-fg-muted">{s.context}</p>
              <SparseTimeline symbol={s} start={start} end={end} />
              {s.around.length ? (
                <ul className="mt-1.5 text-xs text-fg-muted" aria-label="Confirmed events nearby">
                  {s.around.slice(0, 3).map((a) => (
                    <li key={a.eventId} className="py-0.5">
                      <Link href={`/event/${a.eventId}`} className="underline underline-offset-4">
                        {a.description}
                      </Link>{' '}
                      —{' '}
                      {a.relation === 'same day'
                        ? 'the same day'
                        : `${a.days} ${a.days === 1 ? 'day' : 'days'} ${a.relation}`}
                      {a.confirmed ? ' · connection you confirmed' : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-1.5" aria-label={`Readings with ${s.label}`}>
                {s.sourceObjectIds.map((id) => (
                  <li key={id} className="py-1">
                    <Link
                      href={`/reading/${id}`}
                      className="text-accent underline underline-offset-4"
                    >
                      {titles.get(id) ?? 'Reading'}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** One row of dots on a time axis; the sentence beneath is its text equivalent. */
function SparseTimeline({
  symbol,
  start,
  end,
}: {
  symbol: RecurringSymbol;
  start: number;
  end: number;
}) {
  const sentence = occurrencesSentence(symbol);
  const width = 280;
  const x = (iso: string) => 6 + ((Date.parse(iso) - start) / (end - start)) * (width - 12);
  return (
    <figure className="mt-2" data-testid="symbol-timeline">
      <svg
        viewBox={`0 0 ${width} 16`}
        className="h-4 w-full max-w-[280px] overflow-visible"
        role="img"
        aria-label={sentence}
      >
        <line
          x1="6"
          x2={width - 6}
          y1="8"
          y2="8"
          className="stroke-hairline-strong"
          strokeWidth="1"
        />
        {symbol.occurrences.map((o) => (
          <circle key={o.objectId} cx={x(o.at)} cy="8" r="3.5" className="fill-accent" />
        ))}
      </svg>
      <figcaption className="mt-0.5 text-xs text-fg-muted">{sentence}</figcaption>
    </figure>
  );
}
