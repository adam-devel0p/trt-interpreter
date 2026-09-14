'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { HomeInsight, ReadingRef } from '@/retention/home';
import { periodLabel } from '@/domain/summaries/periods';
import { Button } from '@/ui/components/button';
import { LocalTime } from '@/ui/components/local-time';
import { dismissInsightAction } from './actions';

/**
 * Home's one insight (spec §5, §15.2): a journey shift, an unresolved-question review, a
 * month to look back on, or one old reading on this day. Every variant is dismissible in
 * one tap, links to the entries it rests on, and never asks for a new pull — the review
 * offers reflection and outcome recording *instead* (§10, §4.7).
 */
export function InsightCard({ insight }: { insight: HomeInsight }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (gone) return <p className="text-sm text-fg-muted">Dismissed. Nothing else is waiting.</p>;
  const dismiss = () =>
    start(async () => {
      const res = await dismissInsightAction(insight.promptId);
      if (res.ok) {
        setGone(true);
        router.refresh();
      } else setError(res.message);
    });
  const Dismiss = (
    <div className="mt-3 flex items-center gap-3">
      <Button variant="ghost" size="sm" onClick={dismiss} disabled={pending}>
        Dismiss
      </Button>
      {error ? <span className="text-sm text-fg-muted">{error}</span> : null}
    </div>
  );
  const readingList = (readings: ReadingRef[]) => (
    <ul className="mt-2 flex flex-col gap-1 text-sm">
      {readings.map((r) => (
        <li key={r.id} data-deck={r.deck?.system}>
          <Link
            href={`/reading/${r.id}#follow-up-h`}
            className="text-accent underline underline-offset-4"
          >
            {r.title}
          </Link>
          <span className="text-fg-muted">
            {' '}
            · <LocalTime iso={r.occurredAt} dateOnly />
          </span>
        </li>
      ))}
    </ul>
  );

  switch (insight.kind) {
    case 'journey_shift':
      return (
        <article
          className="rounded-card bg-surface px-4 py-3 hairline"
          data-testid="insight"
          data-kind="journey_shift"
        >
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            Something moved
          </p>
          <p className="mt-1 font-serif text-lg leading-snug">{insight.sentence}</p>
          {readingList(insight.readings)}
          <p className="mt-2 text-sm">
            <Link
              href={`/journey/${insight.journey.id}#progression-h`}
              className="text-accent underline underline-offset-4"
            >
              See the journey
            </Link>
          </p>
          {Dismiss}
        </article>
      );
    case 'unresolved_review':
      return (
        <article
          className="rounded-card bg-surface px-4 py-3 hairline"
          data-testid="insight"
          data-kind="unresolved_review"
        >
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            Worth a look back
          </p>
          <p className="mt-1 font-serif text-lg leading-snug">
            You have asked about {insight.subject} {insight.readings.length} times without saying
            what happened.
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Rather than another pull, sit with these for a moment: what did happen, and what has the
            question been for? Record what you know on any of them — “unresolved” is an honest
            answer.
          </p>
          {readingList(insight.readings)}
          {Dismiss}
        </article>
      );
    case 'retrospective':
      return (
        <article
          className="rounded-card bg-surface px-4 py-3 hairline"
          data-testid="insight"
          data-kind="retrospective"
        >
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            A month to look back on
          </p>
          <p className="mt-1 font-serif text-lg leading-snug">
            {periodLabel(insight.period)}: {insight.readings}{' '}
            {insight.readings === 1 ? 'reading' : 'readings'}
            {insight.events
              ? ` and ${insight.events} ${insight.events === 1 ? 'life event' : 'life events'}`
              : ''}
            .
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/retrospective/${insight.period.key}`}
              className="text-accent underline underline-offset-4"
            >
              Open the retrospective
            </Link>
          </p>
          {Dismiss}
        </article>
      );
    case 'on_this_day':
      return (
        <article
          className="rounded-card bg-surface px-4 py-3 hairline"
          data-testid="insight"
          data-kind="on_this_day"
        >
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {insight.yearsAgo > 0
              ? `On this day, ${insight.yearsAgo === 1 ? 'a year' : `${insight.yearsAgo} years`} ago`
              : '30 days ago'}
          </p>
          <Link
            href={`/reading/${insight.reading.id}`}
            data-deck={insight.reading.deck?.system}
            className="mt-1 block font-serif text-lg leading-snug hover:underline"
          >
            {insight.reading.title}
          </Link>
          <p className="mt-1 text-sm text-fg-muted">
            <LocalTime iso={insight.reading.occurredAt} dateOnly />
            {insight.reading.deck ? ` · ${insight.reading.deck.name}` : ''}. Worth a re-read: does
            it still land the same way? If something has since happened, you can say so on the
            reading.
          </p>
          {Dismiss}
        </article>
      );
  }
}
