'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { OutcomeView } from '@/db/queries/events';
import { EVENT_DESCRIPTION_MAX, todayIso } from '@/domain/events/types';
import {
  OUTCOME_LABEL,
  OUTCOME_NOTE_MAX,
  OUTCOME_SHORT,
  OUTCOME_STATUSES,
  type OutcomeStatus,
} from '@/domain/outcomes/followUp';
import { Button } from '@/ui/components/button';
import { Field, FormMessage } from '@/ui/components/field';
import { LocalTime } from '@/ui/components/local-time';
import { cn } from '@/ui/lib/cn';
import { recordOutcomeAction } from '../../event/actions';

/**
 * "What happened?" (FR-14, FR-15). One tap on a status records an outcome for the reading;
 * an optional note and an optional life event (an existing one, or a sentence that becomes
 * one) go with it. Each open possibility can be answered on its own. Outcomes are the
 * user's word alone — nothing here is suggested or pre-filled by a model. Append-only:
 * recording again keeps the earlier record.
 */
export function OutcomePanel({
  readingId,
  current,
  history,
  possibilities,
  events,
}: {
  readingId: string;
  current: OutcomeView | null;
  history: OutcomeView[];
  possibilities: { id: string; text: string; current: OutcomeView | null }[];
  events: { id: string; description: string; occurred_on: string }[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const [status, setStatus] = React.useState<OutcomeStatus | null>(null);
  const [note, setNote] = React.useState('');
  const [eventMode, setEventMode] = React.useState<'none' | 'existing' | 'new'>('none');
  const [eventId, setEventId] = React.useState('');
  const [newEvent, setNewEvent] = React.useState('');
  const [newDate, setNewDate] = React.useState(() => todayIso());

  const submit = (input: {
    status: OutcomeStatus;
    predictionId?: string | null;
    note?: string | null;
    lifeEventId?: string | null;
    newEvent?: string | null;
    occurredOn?: string | null;
  }) => {
    setError(null);
    start(async () => {
      const res = await recordOutcomeAction({
        readingId,
        predictionId: input.predictionId ?? null,
        status: input.status,
        note: input.note ?? null,
        lifeEventId: input.lifeEventId ?? null,
        newEvent: input.newEvent ?? null,
        occurredOn: input.occurredOn ?? null,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSaid(`Recorded: ${OUTCOME_LABEL[input.status].toLowerCase()}.`);
      setStatus(null);
      setNote('');
      setEventMode('none');
      setEventId('');
      setNewEvent('');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="outcome-panel">
      {current ? (
        <div className="rounded-card bg-surface px-4 py-3 text-sm hairline">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            What happened · you, <LocalTime iso={current.user_confirmed_at} dateOnly />
          </p>
          <p className="mt-1 font-medium">{OUTCOME_LABEL[current.status]}</p>
          {current.note ? (
            <p className="prose-content mt-1 whitespace-pre-wrap">{current.note}</p>
          ) : null}
          {current.event ? (
            <p className="mt-1 text-fg-muted">
              Event:{' '}
              <Link
                href={`/event/${current.event.id}`}
                className="text-accent underline underline-offset-4"
              >
                {current.event.description}
              </Link>
            </p>
          ) : null}
          {history.length > 1 ? (
            <details className="mt-2 text-xs text-fg-muted">
              <summary className="min-h-7 cursor-pointer">
                Earlier records ({history.length - 1})
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {history.slice(1).map((o) => (
                  <li key={o.id}>
                    <LocalTime iso={o.user_confirmed_at} dateOnly /> · {OUTCOME_SHORT[o.status]}
                    {o.note ? ` — ${o.note}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div>
        <p id="outcome-h" className="text-sm font-medium">
          {current ? 'Update what happened' : 'What happened?'}
        </p>
        <div role="group" aria-labelledby="outcome-h" className="mt-2 flex flex-wrap gap-2">
          {OUTCOME_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              disabled={pending}
              onClick={() => setStatus(status === s ? null : s)}
              className={cn(
                'min-h-11 rounded-chip px-4 text-sm font-medium transition-colors',
                status === s
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface text-fg hairline hover:bg-surface-2',
              )}
            >
              {OUTCOME_LABEL[s]}
            </button>
          ))}
        </div>
        {status ? (
          <form
            className="mt-3 flex flex-col gap-3 rounded-card bg-surface px-4 py-3 hairline"
            onSubmit={(e) => {
              e.preventDefault();
              submit({
                status,
                note: note.trim() || null,
                lifeEventId: eventMode === 'existing' && eventId ? eventId : null,
                newEvent: eventMode === 'new' && newEvent.trim() ? newEvent.trim() : null,
                occurredOn: eventMode === 'new' ? newDate : null,
              });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="outcome-note" className="text-sm font-medium">
                A note <span className="font-normal text-fg-muted">(optional)</span>
              </label>
              <textarea
                id="outcome-note"
                rows={2}
                maxLength={OUTCOME_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="prose-content w-full resize-y rounded-control bg-bg px-3 py-2 text-base text-fg hairline placeholder:text-fg-faint"
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                The life event <span className="font-normal text-fg-muted">(optional)</span>
              </legend>
              <div className="flex flex-wrap gap-2 text-sm">
                {(
                  [
                    ['none', 'None'],
                    ['new', 'Log one now'],
                    ...(events.length ? [['existing', 'Pick an existing one']] : []),
                  ] as [typeof eventMode, string][]
                ).map(([mode, label]) => (
                  <label key={mode} className="inline-flex min-h-9 items-center gap-1.5">
                    <input
                      type="radio"
                      name="event-mode"
                      checked={eventMode === mode}
                      onChange={() => setEventMode(mode)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {eventMode === 'existing' ? (
                <select
                  aria-label="Existing life event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="min-h-11 rounded-control bg-bg px-3 text-base text-fg hairline"
                >
                  <option value="">Choose…</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.occurred_on} · {ev.description}
                    </option>
                  ))}
                </select>
              ) : eventMode === 'new' ? (
                <>
                  <Field
                    id="outcome-new-event"
                    label="What happened, in a sentence"
                    value={newEvent}
                    maxLength={EVENT_DESCRIPTION_MAX}
                    onChange={(e) => setNewEvent(e.target.value)}
                  />
                  <Field
                    id="outcome-new-date"
                    label="When"
                    type="date"
                    value={newDate}
                    max={todayIso()}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                </>
              ) : null}
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                Record
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setStatus(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {possibilities.length ? (
        <div>
          <p className="text-sm font-medium">For a specific possibility</p>
          <ul className="mt-2 flex flex-col gap-2">
            {possibilities.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-1 rounded-card bg-surface px-3 py-2 text-sm hairline"
              >
                <span>{p.text}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`poss-${p.id}`} className="text-xs text-fg-muted">
                    {p.current ? `You said: ${OUTCOME_SHORT[p.current.status]}` : 'Not answered'}
                  </label>
                  <select
                    id={`poss-${p.id}`}
                    aria-label={`Outcome for: ${p.text}`}
                    value=""
                    disabled={pending}
                    onChange={(e) => {
                      const v = e.target.value as OutcomeStatus | '';
                      if (v) submit({ status: v, predictionId: p.id });
                    }}
                    className="min-h-9 rounded-control bg-bg px-2 text-sm text-fg hairline"
                  >
                    <option value="">{p.current ? 'Change…' : 'Answer…'}</option>
                    {OUTCOME_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {OUTCOME_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
