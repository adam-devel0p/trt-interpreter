'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  FOLLOW_UP_LABEL,
  FOLLOW_UP_STATUSES,
  NOTES_MAX,
  type FollowUpStatus,
} from '@/domain/readings/types';
import { REVISIT_OFFSETS } from '@/domain/readings/thresholds';
import { Button } from '@/ui/components/button';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { FormMessage } from '@/ui/components/field';
import { UserNoteEditor } from '@/ui/components/user-note-editor';
import { cn } from '@/ui/lib/cn';
import {
  deleteReadingAction,
  setFollowUpAction,
  setRevisitAction,
  updateNotesAction,
} from '../actions';

/** "Your interpretation": autosaving, in the user's own typeface, never restyled. */
export function NotesEditor({ readingId, initial }: { readingId: string; initial: string }) {
  return (
    <UserNoteEditor
      id="reading-notes"
      label="In your own words"
      initial={initial}
      maxLength={NOTES_MAX}
      placeholder="What you notice, what it brings up, what you want to remember."
      onSave={async (text) => {
        const res = await updateNotesAction(readingId, text);
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

/** One tap per status (§6.3); optimistic, reverted with a message on failure. */
export function FollowUpControl({
  readingId,
  status,
  revisitAt,
}: {
  readingId: string;
  status: FollowUpStatus;
  revisitAt: string | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = React.useState(status);
  // An outcome recorded below (Phase 08) moves the status on the server; follow it.
  React.useEffect(() => setCurrent(status), [status]);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const choose = (next: FollowUpStatus) => {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    setError(null);
    start(async () => {
      const res = await setFollowUpAction(readingId, next);
      if (!res.ok) {
        setCurrent(prev);
        setError(res.message);
      } else router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Follow-up status" className="flex flex-wrap gap-2">
        {FOLLOW_UP_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={current === s}
            disabled={pending}
            onClick={() => choose(s)}
            className={cn(
              'min-h-11 rounded-chip px-4 text-sm font-medium transition-colors',
              current === s
                ? 'bg-accent text-on-accent'
                : 'bg-surface text-fg hairline hover:bg-surface-2',
            )}
          >
            {FOLLOW_UP_LABEL[s]}
          </button>
        ))}
      </div>
      {revisitAt ? <ClearRevisit readingId={readingId} /> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

function ClearRevisit({ readingId }: { readingId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setRevisitAction(readingId, null);
          router.refresh();
        })
      }
      className="self-start text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
    >
      Clear the revisit date
    </button>
  );
}

/** Offered once, after saving a future-facing reading (FR-14). Dismissible; never nags. */
export function RevisitChips({ readingId }: { readingId: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  if (dismissed) return null;
  const pick = (days: number | null) => {
    setError(null);
    if (days === null) {
      setDismissed(true);
      return;
    }
    start(async () => {
      const at = new Date();
      at.setUTCDate(at.getUTCDate() + days);
      at.setUTCHours(9, 0, 0, 0);
      const res = await setRevisitAction(readingId, at.toISOString());
      if (!res.ok) setError(res.message);
      else {
        setDismissed(true);
        router.replace(`/reading/${readingId}`);
        router.refresh();
      }
    });
  };
  return (
    <div role="group" aria-labelledby="revisit-h" className="rounded-card bg-surface p-4 hairline">
      <p id="revisit-h" className="text-sm font-medium">
        Revisit this?
      </p>
      <p className="mt-0.5 text-sm text-fg-muted">
        A gentle reminder to note what happened. Optional.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REVISIT_OFFSETS.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={pending}
            onClick={() => pick(o.days)}
            className="min-h-11 rounded-chip bg-surface px-4 text-sm font-medium hairline hover:bg-surface-2"
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => pick(null)}
          className="min-h-11 rounded-chip px-4 text-sm font-medium text-fg-muted hover:bg-surface-2"
        >
          No thanks
        </button>
      </div>
      {error ? (
        <FormMessage tone="error" className="mt-3">
          {error}
        </FormMessage>
      ) : null}
    </div>
  );
}

export interface DeletionSummary {
  cards: number;
  hasNotes: boolean;
  interpretations: number;
  revisions: number;
}

/** "This reading, its 3 cards, your notes and 2 earlier versions of them, 1 AI interpretation." */
export function describeDeletion(s: DeletionSummary): string {
  const parts = [`its ${s.cards} card${s.cards === 1 ? '' : 's'}`];
  if (s.hasNotes) parts.push('your notes');
  if (s.revisions > 0)
    parts.push(`${s.revisions} earlier version${s.revisions === 1 ? '' : 's'} of your words`);
  if (s.interpretations > 0)
    parts.push(`${s.interpretations} AI interpretation${s.interpretations === 1 ? '' : 's'}`);
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This reading, ${list}. It leaves your timeline now and is purged for good within minutes. This cannot be undone.`;
}

/** Edit, delete (confirmed, naming exactly what goes), export (Profile) and the share placeholder. */
export function ReadingControls({
  readingId,
  summary,
}: {
  readingId: string;
  summary: DeletionSummary;
}) {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href={`/reading/${readingId}/edit`}>Edit</Link>
        </Button>
        <ConfirmDestructive
          trigger={<Button variant="secondary">Delete</Button>}
          title="Delete this reading?"
          description={describeDeletion(summary)}
          confirmLabel="Delete reading"
          onConfirm={async () => {
            const res = await deleteReadingAction(readingId);
            if (res && !res.ok) setError(res.message);
          }}
        />
        <Button asChild variant="secondary">
          <Link href="/profile#export">Export</Link>
        </Button>
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center gap-2 rounded-control px-4 text-sm font-medium text-fg-muted opacity-70"
        >
          Share <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs">Phase 11</span>
        </span>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
