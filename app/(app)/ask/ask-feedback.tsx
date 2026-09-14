'use client';

import * as React from 'react';
import { cn } from '@/ui/lib/cn';
import { setAskFeedbackAction } from './actions';

/** Thumbs on an answer (§16): one tap, undoable, never a form. */
export function AskFeedback({ askId, initial }: { askId: string; initial: -1 | 1 | null }) {
  const [value, setValue] = React.useState<-1 | 1 | null>(initial);
  const [note, setNote] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const set = (next: -1 | 1) => {
    const v = value === next ? null : next;
    setValue(v);
    start(async () => {
      const r = await setAskFeedbackAction(askId, v);
      setNote(r.ok ? (v === null ? 'Feedback cleared.' : 'Thanks — noted.') : r.message);
    });
  };
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted"
      role="group"
      aria-label="Was this answer useful?"
    >
      <span>Useful?</span>
      <button
        type="button"
        aria-pressed={value === 1}
        disabled={pending}
        onClick={() => set(1)}
        className={cn(
          'min-h-9 rounded-control px-3 hairline',
          value === 1 && 'bg-surface-2 text-fg',
        )}
      >
        Yes
      </button>
      <button
        type="button"
        aria-pressed={value === -1}
        disabled={pending}
        onClick={() => set(-1)}
        className={cn(
          'min-h-9 rounded-control px-3 hairline',
          value === -1 && 'bg-surface-2 text-fg',
        )}
      >
        Not really
      </button>
      <span role="status" aria-live="polite">
        {note}
      </span>
    </div>
  );
}
