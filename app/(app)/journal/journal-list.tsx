'use client';

import * as React from 'react';
import type { JournalItem, JournalPage } from '@/db/queries/journal';
import { groupByMonth } from '@/domain/journal/filters';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { FormMessage } from '@/ui/components/field';
import { TimelineItem } from '@/ui/components/timeline-item';
import { loadJournalPageAction } from './actions';

/**
 * The timeline (FR-07): reverse-chronological, grouped by month, cursor-paginated. The first
 * page is server-rendered; the next arrives when the sentinel scrolls into view (or on the
 * button, for keyboard and reduced-motion users). Months are grouped in UTC on the server and
 * re-grouped in the viewer's zone after mount, the same way `LocalTime` handles dates. A
 * polite live region announces the result count so a search is heard, not only seen.
 */
export function JournalList({
  initial,
  rawParams,
  active,
}: {
  initial: JournalPage;
  rawParams: Record<string, string>;
  active: boolean;
}) {
  const [items, setItems] = React.useState<JournalItem[]>(initial.items);
  const [cursor, setCursor] = React.useState<string | null>(initial.nextCursor);
  const [timeZone, setTimeZone] = React.useState<string>('UTC');
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const sentinel = React.useRef<HTMLDivElement>(null);
  const matched = React.useMemo(() => new Set(initial.matchedCardIds), [initial.matchedCardIds]);

  React.useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);

  const loadMore = React.useCallback(() => {
    if (!cursor || pending) return;
    setError(null);
    start(async () => {
      const res = await loadJournalPageAction(rawParams, cursor, timeZone);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(res.page.nextCursor);
    });
  }, [cursor, pending, rawParams, timeZone]);

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const groups = groupByMonth(items, (i) => i.occurred_at, { timeZone });
  const summary =
    items.length === 0
      ? 'No readings match.'
      : `${items.length}${cursor ? '+' : ''} reading${items.length === 1 ? '' : 's'}${active ? ' match' : ''}.`;

  return (
    <div>
      <p
        id="journal-summary"
        role="status"
        aria-live="polite"
        className="mb-3 text-sm text-fg-muted"
      >
        {summary}
      </p>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          description="Try fewer filters, a card name (aliases work across decks), or a word from a note."
        />
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`month-${g.key}`} className="mb-6">
            <h2
              id={`month-${g.key}`}
              className="sticky top-0 z-10 -mx-1 mb-2 bg-bg px-1 py-1.5 font-serif text-lg"
            >
              {g.label}
            </h2>
            <ol className="flex flex-col gap-2">
              {g.items.map((item) => (
                <TimelineItem key={item.id} item={item} matchedCardIds={matched} />
              ))}
            </ol>
          </section>
        ))
      )}
      <div ref={sentinel} aria-hidden="true" />
      {cursor ? (
        <div className="flex justify-center py-2">
          <Button variant="secondary" onClick={loadMore} disabled={pending}>
            {pending ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
