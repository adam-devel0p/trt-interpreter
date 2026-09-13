import Link from 'next/link';
import * as React from 'react';
import type { RecurringSymbol } from '@/domain/journeys/symbols';

/**
 * Recurring symbols (spec §3.3): each with context and its source readings, never a bare
 * count. A card carries its own deck's name (§6.7): Thoth *Lust* and RWS *Strength* are two
 * rows if both recur, never one.
 */
export function RecurringSymbols({
  symbols,
  titles,
}: {
  symbols: RecurringSymbol[];
  /** Reading id → title, for the source list. */
  titles: Map<string, string>;
}) {
  if (symbols.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="recurring-symbols">
      {symbols.map((s) => (
        <li key={s.key} data-symbol-kind={s.kind} data-deck={s.deck?.system}>
          <details className="group rounded-card bg-surface hairline">
            <summary className="flex min-h-11 cursor-pointer list-none items-baseline gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-fg-muted">
                {s.kind === 'theme' ? 'theme' : s.deck ? `${s.kind} · ${s.deck.name}` : s.kind}
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
