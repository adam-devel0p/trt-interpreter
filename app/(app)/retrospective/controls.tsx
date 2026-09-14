'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import {
  dismissSummaryAction,
  regenerateNarrativeAction,
  regenerateSummaryAction,
} from './actions';

type Target =
  | { kind: 'weekly' | 'monthly' | 'yearly'; periodKey: string }
  | { kind: 'journey'; journeyId: string };

/**
 * Dismiss / regenerate for a summary (FR-20 "dismissible; regeneration explicit"). Regenerate
 * is the only control on these screens that calls a model, and it says so.
 */
export function SummaryControls({
  summaryId,
  dismissed,
  target,
  canGenerate,
}: {
  summaryId: string | null;
  dismissed: boolean;
  target: Target;
  /** Consent + flag; without them the control explains instead of calling. */
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(
    null,
  );
  const regenerate = () =>
    start(async () => {
      setMessage(null);
      const res = await regenerateSummaryAction(target);
      if (res.ok) {
        setMessage({ tone: 'info', text: 'Written afresh from your entries.' });
        router.refresh();
      } else setMessage({ tone: 'error', text: res.message });
    });
  const dismiss = (next: boolean) =>
    start(async () => {
      setMessage(null);
      if (!summaryId) return;
      const res = await dismissSummaryAction(summaryId, next);
      if (res.ok) router.refresh();
      else setMessage({ tone: 'error', text: res.message });
    });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="summary-controls">
      {summaryId ? (
        <Button variant="ghost" size="sm" onClick={() => dismiss(!dismissed)} disabled={pending}>
          {dismissed ? 'Show the summary again' : 'Dismiss this summary'}
        </Button>
      ) : null}
      {canGenerate ? (
        <Button variant="secondary" size="sm" onClick={regenerate} disabled={pending}>
          {pending
            ? 'Writing…'
            : summaryId
              ? 'Regenerate (one model call)'
              : 'Write a summary (one model call)'}
        </Button>
      ) : null}
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </div>
  );
}

export function NarrativeControls({
  journeyId,
  canGenerate,
}: {
  journeyId: string;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  if (!canGenerate) return null;
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await regenerateNarrativeAction(journeyId);
            setMessage(res.ok ? null : res.message);
            if (res.ok) router.refresh();
          })
        }
      >
        {pending ? 'Writing…' : 'Rewrite the header (one model call)'}
      </Button>
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
    </div>
  );
}
