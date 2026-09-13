'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { acceptJourneyAction, dismissJourneyAction } from './actions';

/**
 * The one suggested-journey card (spec §6.5, §4.3): quiet, dismissible for good, never a
 * modal and never nagging. Shown on Home and at the top of the Journeys list.
 */
export function SuggestedJourneyCard({
  journey,
  compact = false,
}: {
  journey: { id: string; title: string; member_count: number; reasons: string[] };
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message ?? 'Something went wrong.');
        return;
      }
      setSaid(done);
      router.refresh();
    });
  };
  return (
    <section
      aria-labelledby={`suggested-${journey.id}`}
      className="rounded-card border border-dashed border-hairline-strong bg-surface-ai px-4 py-3"
      data-testid="suggested-journey"
    >
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
        Possibly a journey
      </p>
      <h3 id={`suggested-${journey.id}`} className="mt-1 font-serif text-lg leading-snug">
        <Link href={`/journey/${journey.id}`} className="hover:underline">
          {journey.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-fg-muted">
        {journey.member_count} readings seem to be about the same thing.
        {!compact && journey.reasons[0] ? ` ${journey.reasons[0]}.` : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => act(() => acceptJourneyAction(journey.id), 'Journey accepted.')}
        >
          Keep it as a journey
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => act(() => dismissJourneyAction(journey.id), 'Suggestion dismissed.')}
        >
          Not a journey
        </Button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </section>
  );
}
