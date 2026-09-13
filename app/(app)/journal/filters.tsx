'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  hasActiveFilters,
  JOURNAL_SORT_LABEL,
  JOURNAL_SORTS,
  journalHref,
  parseJournalParams,
  type JournalFilters as Filters,
} from '@/domain/journal/filters';
import { FOLLOW_UP_LABEL, FOLLOW_UP_STATUSES } from '@/domain/readings/types';
import { Button } from '@/ui/components/button';
import { cn } from '@/ui/lib/cn';

/**
 * Search box + filter panel (FR-21). A plain GET form: every control has a name, so the URL
 * carries the state, "Clear" is one link, and the whole thing is keyboard-operable by
 * construction. With JavaScript the submit is turned into a clean client navigation (only
 * non-default values in the URL); without it the browser's own GET works the same way.
 * Selects apply on change; the text field applies on Enter or "Search".
 */
export function JournalFilters({
  filters,
  decks,
  spreads,
}: {
  filters: Filters;
  decks: { slug: string; name: string }[];
  spreads: { id: string; name: string }[];
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const active = hasActiveFilters(filters);
  const [open, setOpen] = React.useState(
    active &&
      (filters.from !== null ||
        filters.to !== null ||
        filters.deck !== null ||
        filters.spread !== null ||
        filters.source !== null ||
        filters.followUp !== null ||
        filters.hasNotes !== null ||
        filters.hasInterpretation !== null),
  );
  const submit = () => formRef.current?.requestSubmit();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const params: Record<string, string> = {};
    for (const [k, v] of data.entries()) if (typeof v === 'string') params[k] = v;
    router.push(journalHref(parseJournalParams(params)));
  };
  const selectClass = 'min-h-11 w-full rounded-control bg-surface px-3 text-base text-fg hairline';

  return (
    <form
      ref={formRef}
      method="get"
      action="/journal"
      onSubmit={onSubmit}
      className="mb-5 flex flex-col gap-3"
      role="search"
    >
      <div className="flex gap-2">
        <label htmlFor="journal-q" className="sr-only">
          Search your readings
        </label>
        <input
          id="journal-q"
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Search questions, notes, cards…"
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-11 min-w-0 flex-1 rounded-control bg-surface px-3 text-base text-fg hairline placeholder:text-fg-faint"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>
      {filters.sort !== 'newest' && !open ? (
        <input type="hidden" name="sort" value={filters.sort} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="journal-filter-panel"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'min-h-11 rounded-chip px-4 text-sm font-medium hairline',
            open || active ? 'bg-accent-soft text-fg' : 'bg-surface text-fg',
          )}
        >
          Filters{active ? ' · on' : ''}
        </button>
        {active ? (
          <Link
            href="/journal"
            className="inline-flex min-h-11 items-center px-2 text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
          >
            Clear all
          </Link>
        ) : null}
      </div>

      <div
        id="journal-filter-panel"
        hidden={!open}
        className="grid grid-cols-1 gap-3 rounded-card bg-surface p-4 hairline sm:grid-cols-2"
      >
        <Labelled id="journal-from" label="From">
          <input
            id="journal-from"
            name="from"
            type="date"
            defaultValue={filters.from ?? ''}
            onChange={submit}
            className={selectClass}
          />
        </Labelled>
        <Labelled id="journal-to" label="To">
          <input
            id="journal-to"
            name="to"
            type="date"
            defaultValue={filters.to ?? ''}
            onChange={submit}
            className={selectClass}
          />
        </Labelled>
        <Labelled id="journal-deck" label="Deck">
          <select
            id="journal-deck"
            name="deck"
            defaultValue={filters.deck ?? ''}
            onChange={submit}
            className={selectClass}
          >
            <option value="">Any deck</option>
            {decks.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled id="journal-spread" label="Spread">
          <select
            id="journal-spread"
            name="spread"
            defaultValue={filters.spread ?? ''}
            onChange={submit}
            className={selectClass}
          >
            <option value="">Any spread</option>
            {spreads.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled id="journal-source" label="Source">
          <select
            id="journal-source"
            name="source"
            defaultValue={filters.source ?? ''}
            onChange={submit}
            className={selectClass}
          >
            <option value="">Digital or physical</option>
            <option value="digital">Digital draw</option>
            <option value="physical">Physical deck</option>
          </select>
        </Labelled>
        <Labelled id="journal-status" label="Follow-up">
          <select
            id="journal-status"
            name="status"
            defaultValue={filters.followUp ?? ''}
            onChange={submit}
            className={selectClass}
          >
            <option value="">Any status</option>
            {FOLLOW_UP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FOLLOW_UP_LABEL[s]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled id="journal-notes" label="Your notes">
          <select
            id="journal-notes"
            name="notes"
            defaultValue={filters.hasNotes === null ? '' : filters.hasNotes ? '1' : '0'}
            onChange={submit}
            className={selectClass}
          >
            <option value="">With or without</option>
            <option value="1">Has notes</option>
            <option value="0">No notes</option>
          </select>
        </Labelled>
        <Labelled id="journal-ai" label="AI interpretation">
          <select
            id="journal-ai"
            name="ai"
            defaultValue={
              filters.hasInterpretation === null ? '' : filters.hasInterpretation ? '1' : '0'
            }
            onChange={submit}
            className={selectClass}
          >
            <option value="">With or without</option>
            <option value="1">Has one</option>
            <option value="0">None</option>
          </select>
        </Labelled>
        <Labelled id="journal-sort" label="Sort">
          <select
            id="journal-sort"
            name="sort"
            defaultValue={filters.sort}
            onChange={submit}
            className={selectClass}
          >
            {JOURNAL_SORTS.map((s) => (
              <option key={s} value={s}>
                {JOURNAL_SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </Labelled>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" className="w-full">
            Apply filters
          </Button>
        </div>
      </div>
    </form>
  );
}

function Labelled({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
