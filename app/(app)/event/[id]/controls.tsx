'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/ui/components/button';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { Field, FormMessage } from '@/ui/components/field';
import { deleteEventAction, setEventDateAction } from '../actions';

/** Change the date (the one editable fact) or delete — naming what goes. */
export function EventControls({
  eventId,
  occurredOn,
  connections,
  photos,
}: {
  eventId: string;
  occurredOn: string;
  connections: number;
  photos: number;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState(occurredOn);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const parts = ['this event'];
  if (photos) parts.push(`its ${photos} photo${photos === 1 ? '' : 's'}`);
  if (connections)
    parts.push(`${connections} connection${connections === 1 ? '' : 's'} to readings`);
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (date === occurredOn) return;
          setError(null);
          start(async () => {
            const res = await setEventDateAction(eventId, date);
            if (!res.ok) setError(res.message);
            else {
              setSaid('Date changed.');
              router.refresh();
            }
          });
        }}
      >
        <Field
          id="event-date-edit"
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-44"
        />
        <Button type="submit" variant="secondary" disabled={pending || date === occurredOn}>
          Change date
        </Button>
      </form>
      <p className="text-xs text-fg-muted">
        The words themselves are never edited. If they are wrong, delete this and log it again.
      </p>
      <div>
        <ConfirmDestructive
          trigger={<Button variant="secondary">Delete</Button>}
          title="Delete this event?"
          description={`${parts.join(', ')}. The readings stay exactly as they are. This cannot be undone.`}
          confirmLabel="Delete event"
          onConfirm={async () => {
            const res = await deleteEventAction(eventId);
            if (!res.ok) setError(res.message);
            else router.push('/event');
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

/** Refreshes the page a few times while a queued job is expected to land (no polling forever). */
export function RefreshWhile({
  active,
  everyMs = 2500,
  times = 12,
}: {
  active: boolean;
  everyMs?: number;
  times?: number;
}) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > times) {
        clearInterval(t);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, times, router]);
  return null;
}
