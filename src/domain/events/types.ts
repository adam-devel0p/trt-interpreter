/**
 * Life events (spec §6.4): one sentence, a date, optionally a note and a photo. No
 * multi-field form and no required tarot framing — an event can exist with no reading
 * link. Validation here is what the save action re-checks whatever the client sent.
 */
import { z } from 'zod';
import type { EventTypeKey } from '../extraction/schema';

export const EVENT_DESCRIPTION_MAX = 280;
export const EVENT_NOTE_MAX = 2000;
export const EVENT_ALT_TEXT_MAX = 200;
export const EVENT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const EVENT_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date');

export const createEventInputSchema = z
  .object({
    description: z.string().trim().min(1).max(EVENT_DESCRIPTION_MAX),
    /** Defaults to today (the caller's date). Back-dating is one field away. */
    occurred_on: isoDate,
    note: z.string().trim().max(EVENT_NOTE_MAX).nullable().default(null),
    /** "Something happened about this reading." */
    reading_id: z.string().uuid().nullable().default(null),
  })
  .strict();
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

/** Display labels for the extractor's event types (stable keys in `domain/extraction/schema.ts`, §13). */
export const EVENT_TYPES: readonly { key: EventTypeKey; label: string }[] = [
  { key: 'work', label: 'Work' },
  { key: 'relationship', label: 'Relationship' },
  { key: 'home', label: 'Home' },
  { key: 'health', label: 'Health' },
  { key: 'money', label: 'Money' },
  { key: 'family', label: 'Family' },
  { key: 'travel', label: 'Travel' },
  { key: 'learning', label: 'Learning' },
  { key: 'loss', label: 'Loss' },
  { key: 'milestone', label: 'Milestone' },
  { key: 'other', label: 'Other' },
];
export type { EventTypeKey };

export function eventTypeLabel(key: string | null): string | null {
  return EVENT_TYPES.find((t) => t.key === key)?.label ?? null;
}

/** Today's date as YYYY-MM-DD in the given zone (the entry form's default). */
export function todayIso(now: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(now);
}
