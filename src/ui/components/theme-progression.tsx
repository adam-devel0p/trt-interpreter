import Link from 'next/link';
import * as React from 'react';

export interface ProgressionStepItem {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  sources: { id: string; title: string; at: string }[];
}

function monthOf(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Theme progression (FR-17, §4.3): a labelled sequence — "uncertainty → conflict →
 * decision" — never a chart. Readable as one sentence by a screen reader; each step opens
 * to the readings it rests on (≥ 2 by construction). Tap targets are the whole summary row.
 */
export function ThemeProgression({ steps }: { steps: ProgressionStepItem[] }) {
  if (steps.length === 0) return null;
  const sentence = steps.map((s) => s.label.toLowerCase()).join(', then ');
  return (
    <div data-testid="theme-progression">
      <p className="sr-only">The themes moved from {sentence}.</p>
      <ol className="flex flex-wrap items-stretch gap-2" aria-hidden="false">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden="true" className="text-fg-muted">
                →
              </span>
            ) : null}
            <details className="group min-w-0 rounded-card bg-surface hairline">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-fg-muted">
                  {monthOf(s.periodStart) === monthOf(s.periodEnd)
                    ? monthOf(s.periodStart)
                    : `${monthOf(s.periodStart)} – ${monthOf(s.periodEnd)}`}
                </span>
                <span
                  aria-hidden="true"
                  className="text-fg-muted transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <ul
                className="border-t border-hairline px-3 py-2 text-sm"
                aria-label={`Readings behind ${s.label}`}
              >
                {s.sources.map((r) => (
                  <li key={r.id} className="py-1">
                    <Link
                      href={`/reading/${r.id}`}
                      className="text-accent underline underline-offset-4"
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}
