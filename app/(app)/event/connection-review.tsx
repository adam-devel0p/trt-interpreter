'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { LinkedEvent, LinkedReading, LinkView } from '@/db/queries/events';
import type { SignalName } from '@/domain/correlation/score';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { LocalTime } from '@/ui/components/local-time';
import { cn } from '@/ui/lib/cn';
import { linkAction, undoLinkActionAction } from './actions';

/**
 * Connection review (spec §8.2, FR-12, FR-13, §3.3 explainable memory). Each card shows the
 * other side of the link (the reading with its date and cards, or the event), the display
 * band in words, the actual reasons, and — expanded on demand — the full signal breakdown.
 * Three one-tap actions with undo. Inference is always a word: "Possible connection",
 * "Likely connection", never a bare number or a colour.
 */
export interface ConnectionItem {
  link: LinkView;
  other:
    ({ kind: 'reading' } & LinkedReading) | ({ kind: 'event' } & LinkedEvent) | { kind: 'missing' };
}

export const SIGNAL_LABEL: Record<SignalName, string> = {
  journey_overlap: 'Same journey',
  entity_overlap: 'Same people, places or things',
  semantic_similarity: 'Similar wording',
  theme_overlap: 'Shared themes',
  timeframe_fit: 'Inside the reading’s time window',
  temporal_proximity: 'Close in time',
  card_symbol_overlap: 'Same cards',
};

export function bandLabel(band: LinkView['band']): string {
  switch (band) {
    case 'likely':
      return 'Likely connection';
    case 'possible':
      return 'Possible connection';
    case 'confirmed':
      return 'Connected — you confirmed it';
    case 'maybe':
      return 'Maybe — you left it open';
    case 'rejected':
      return 'Unrelated — you said so';
    default:
      return 'Connection';
  }
}

function strength(v: number): string {
  if (v >= 0.75) return 'strong';
  if (v >= 0.4) return 'some';
  if (v > 0) return 'faint';
  return 'none';
}

export function ConnectionReview({
  items,
  emptyText,
  showOther = true,
}: {
  items: ConnectionItem[];
  emptyText?: string;
  /** Hide the other side when the surrounding screen already shows it. */
  showOther?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const [undo, setUndo] = React.useState<{ id: string; what: string } | null>(null);

  const act = (link: LinkView, action: 'confirmed' | 'maybe' | 'rejected') => {
    setError(null);
    start(async () => {
      const res = await linkAction(link.id, action);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const what =
        action === 'confirmed'
          ? 'Connected.'
          : action === 'maybe'
            ? 'Kept as a maybe.'
            : 'Marked unrelated.';
      setSaid(what);
      setUndo({ id: link.id, what });
      router.refresh();
    });
  };
  const undoIt = () => {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    start(async () => {
      const res = await undoLinkActionAction(id);
      if (!res.ok) setError(res.message);
      else {
        setSaid('Undone — back to a suggestion.');
        router.refresh();
      }
    });
  };

  if (items.length === 0 && !undo)
    return emptyText ? (
      <p className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-sm text-fg-muted">
        {emptyText}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="connection-review">
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {undo ? (
        <div className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-2 text-sm hairline">
          <span>{undo.what}</span>
          <button
            type="button"
            onClick={undoIt}
            disabled={pending}
            className="min-h-9 rounded-chip px-3 font-medium text-accent underline underline-offset-4"
          >
            Undo
          </button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {items.map(({ link, other }) => {
          const decided = link.state !== 'pending';
          const title =
            other.kind === 'reading'
              ? other.is_open_reflection
                ? 'Open reflection'
                : (other.question ?? 'Reading')
              : other.kind === 'event'
                ? other.description
                : 'An entry that has since been deleted';
          const href =
            other.kind === 'reading'
              ? `/reading/${other.id}`
              : other.kind === 'event'
                ? `/event/${other.id}`
                : null;
          return (
            <li
              key={link.id}
              data-link-state={link.state}
              data-deck={other.kind === 'reading' ? other.deck.system : undefined}
              className={cn(
                'rounded-card px-4 py-3',
                decided
                  ? 'bg-surface hairline'
                  : 'border border-dashed border-hairline-strong bg-surface-ai',
              )}
            >
              <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                {bandLabel(link.band)}
                {!decided ? <span className="tracking-normal normal-case"> · inferred</span> : null}
              </p>
              {showOther ? (
                <>
                  {href ? (
                    <Link
                      href={href}
                      className="mt-1 block font-serif text-lg leading-snug hover:underline"
                    >
                      {title}
                    </Link>
                  ) : (
                    <p className="mt-1 font-serif text-lg leading-snug text-fg-muted">{title}</p>
                  )}
                  {other.kind === 'reading' ? (
                    <p className="mt-0.5 text-sm text-fg-muted">
                      <LocalTime iso={other.occurred_at} dateOnly /> · {other.spread.name} ·{' '}
                      {other.deck.name}
                      <span className="block" aria-label={`Cards from ${other.deck.name}`}>
                        {other.cards
                          .map(
                            (c) => `${c.name}${c.orientation === 'reversed' ? ' (reversed)' : ''}`,
                          )
                          .join(' · ')}
                      </span>
                    </p>
                  ) : other.kind === 'event' ? (
                    <p className="mt-0.5 text-sm text-fg-muted">
                      <LocalTime iso={`${other.occurred_on}T12:00:00Z`} dateOnly /> · life event
                    </p>
                  ) : null}
                </>
              ) : null}
              {link.explanation ? (
                <p className="mt-2 text-sm">
                  {link.explanation}
                  <span className="text-fg-muted"> — AI wording of the reasons below</span>
                </p>
              ) : null}
              {link.reasons.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Reasons">
                  {link.reasons.map((r, i) => (
                    <li key={i} className="rounded-chip bg-surface px-2 py-0.5 hairline">
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
              {link.signals ? (
                <details className="mt-2 text-sm">
                  <summary className="min-h-9 cursor-pointer py-1.5 text-fg-muted">
                    Why am I seeing this?
                  </summary>
                  <table className="mt-1 w-full text-left text-xs">
                    <caption className="sr-only">Signal breakdown</caption>
                    <tbody>
                      {(Object.keys(SIGNAL_LABEL) as SignalName[]).map((k) => (
                        <tr key={k} className="border-t border-hairline">
                          <th scope="row" className="py-1 pr-2 font-normal text-fg-muted">
                            {SIGNAL_LABEL[k]}
                          </th>
                          <td className="py-1 tabular-nums">{strength(link.signals![k] ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-fg-muted">
                    Computed from your own entries — the people, themes, journeys and dates they
                    share. Nothing here is a prediction.
                  </p>
                </details>
              ) : null}
              {!decided ? (
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  role="group"
                  aria-label={`Decide: ${title}`}
                >
                  <Button size="sm" disabled={pending} onClick={() => act(link, 'confirmed')}>
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => act(link, 'maybe')}
                  >
                    Maybe
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => act(link, 'rejected')}
                  >
                    Unrelated
                  </Button>
                </div>
              ) : link.created_by === 'rule' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {link.state === 'maybe' ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(link, 'confirmed')}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => act(link, 'rejected')}
                      >
                        Unrelated
                      </Button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await undoLinkActionAction(link.id);
                        if (!res.ok) setError(res.message);
                        else router.refresh();
                      })
                    }
                    className="min-h-9 rounded-chip px-2 text-xs text-fg-muted underline underline-offset-4 hover:text-fg"
                  >
                    Change my mind
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-fg-muted">You linked this yourself.</p>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
