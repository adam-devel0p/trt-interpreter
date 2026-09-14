'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  EVENT_ALT_TEXT_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_NOTE_MAX,
  EVENT_PHOTO_TYPES,
  todayIso,
} from '@/domain/events/types';
import { Button } from '@/ui/components/button';
import { Field, FormMessage } from '@/ui/components/field';
import { createEventAction } from './actions';

/**
 * Quick event entry (spec §6.4 — "speed is the feature"). One sentence and a date, both on
 * screen at once; a note and a photo are folded away under one disclosure. No tarot framing
 * is required: the reading, when there is one, is a hidden field the caller set. The
 * sentence is saved before anything else happens.
 */
export function EventForm({
  readingId,
  readingTitle,
}: {
  readingId?: string | null;
  readingTitle?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState('');
  const [date, setDate] = React.useState(() => todayIso());
  const [more, setMore] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [alt, setAlt] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const form = e.currentTarget;
        const data = new FormData(form);
        if (!description.trim()) {
          setError('Say what happened in a sentence.');
          return;
        }
        start(async () => {
          const res = await createEventAction(data);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          router.push(
            `/event/${res.value.id}?saved=1${res.value.photo === 'failed' ? '&photo=failed' : ''}`,
          );
        });
      }}
    >
      {readingId ? (
        <>
          <input type="hidden" name="reading_id" value={readingId} />
          <p className="rounded-card bg-accent-soft px-4 py-2 text-sm">
            About the reading{' '}
            {readingTitle ? <span className="font-medium">“{readingTitle}”</span> : null}. It will
            be connected to it.
          </p>
        </>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-description" className="text-sm font-medium">
          What happened?
        </label>
        <textarea
          id="event-description"
          name="description"
          rows={3}
          autoFocus
          required
          maxLength={EVENT_DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One sentence, in your own words. “I accepted the new job today.”"
          aria-describedby="event-description-hint"
          className="prose-content w-full resize-y rounded-control bg-surface px-3 py-2 text-base text-fg hairline placeholder:text-fg-faint"
        />
        <p id="event-description-hint" className="text-xs text-fg-muted">
          No need to mention a reading. Anything that happened counts.
        </p>
      </div>
      <Field
        id="event-date"
        name="occurred_on"
        label="When"
        type="date"
        value={date}
        max={todayIso()}
        onChange={(e) => setDate(e.target.value)}
        hint="Today unless you change it."
        required
      />
      {!more ? (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="self-start text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          Add a note or a photo
        </button>
      ) : (
        <div className="flex flex-col gap-4 rounded-card bg-surface px-4 py-3 hairline">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-note" className="text-sm font-medium">
              Note <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <textarea
              id="event-note"
              name="note"
              rows={3}
              maxLength={EVENT_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="prose-content w-full resize-y rounded-control bg-bg px-3 py-2 text-base text-fg hairline placeholder:text-fg-faint"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-photo" className="text-sm font-medium">
              Photo <span className="font-normal text-fg-muted">(optional, up to 10 MB)</span>
            </label>
            <input
              id="event-photo"
              ref={fileRef}
              name="photo"
              type="file"
              accept={EVENT_PHOTO_TYPES.join(',')}
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="text-sm file:mr-3 file:min-h-9 file:rounded-chip file:border-0 file:bg-surface-2 file:px-3 file:text-sm file:font-medium"
            />
          </div>
          {fileName ? (
            <Field
              id="event-alt"
              name="alt_text"
              label="Describe the photo"
              hint="A few words for anyone who cannot see it."
              maxLength={EVENT_ALT_TEXT_MAX}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
            />
          ) : null}
        </div>
      )}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
