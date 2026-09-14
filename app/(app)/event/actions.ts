'use server';

import { track } from '@/analytics/track';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { eventMediaStoragePath, uploadEventMedia } from '@/db/admin';
import {
  actOnLink,
  addEventMedia,
  createEvent,
  LINK_ACTIONS,
  recordOutcome,
  setEventDate,
  softDeleteEvent,
  undoLinkAction,
  type LinkAction,
} from '@/db/queries/events';
import { getReadingMemory } from '@/db/queries/memory';
import { getReading } from '@/db/queries/readings';
import {
  createEventInputSchema,
  EVENT_ALT_TEXT_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_PHOTO_MAX_BYTES,
  EVENT_PHOTO_TYPES,
} from '@/domain/events/types';
import { OUTCOME_NOTE_MAX, OUTCOME_STATUSES } from '@/domain/outcomes/followUp';
import { enqueue } from '@/jobs/enqueue';
import { EMBED_AFTER_SAVE_DELAY_MS, enqueueEmbedSafely } from '@/retrieval/enqueue';
import { journeysOfObjects, refreshJourneys } from '@/journeys/refresh';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Life events, connections and outcomes (spec §6.4, FR-11–FR-15). Every write runs as the
 * user through RLS. The event is saved in one insert *before* anything else — the photo
 * upload and the extraction job come after and may fail without losing the sentence
 * (invariant: content first). None of this reaches `src/ai/`: extraction, correlation and
 * explanation are queued jobs. Logs carry ids and classes only.
 */
export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const FAILED = "That didn't go through. Nothing changed — try again.";
const SAVE_FAILED =
  "That didn't save. Nothing you entered is lost — it's still on this screen. Try again.";
const uuid = z.string().uuid();

function revalidate(eventId?: string, readingId?: string | null) {
  revalidatePath('/home');
  revalidatePath('/journal');
  revalidatePath('/event');
  revalidatePath('/journey');
  if (eventId) revalidatePath(`/event/${eventId}`);
  if (readingId) revalidatePath(`/reading/${readingId}`);
}

async function queue(kind: string, payload: Record<string, unknown>, userId: string) {
  try {
    await enqueue(kind, payload, { userId, dedupe: true });
  } catch (err) {
    logger.warn('app.event.enqueue_failed', {
      userId,
      jobKind: kind,
      errorClass: errorClassOf(err),
    });
  }
}

const photoSchema = z.object({
  type: z.enum(EVENT_PHOTO_TYPES),
  size: z.number().int().min(1).max(EVENT_PHOTO_MAX_BYTES),
});

/**
 * Quick entry (§6.4 "speed is the feature"): one sentence, a date, an optional note, an
 * optional photo. Saves first; then the photo, then the extraction job.
 */
export async function createEventAction(
  formData: FormData,
): Promise<ActionResult<{ id: string; photo: 'none' | 'saved' | 'failed' }>> {
  const user = await requireUser();
  const parsed = createEventInputSchema.safeParse({
    description: String(formData.get('description') ?? ''),
    occurred_on: String(formData.get('occurred_on') ?? ''),
    note: (formData.get('note') as string | null)?.trim() || null,
    reading_id: (formData.get('reading_id') as string | null) || null,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    logger.info('app.event.save_rejected', { userId: user.id });
    return {
      ok: false,
      message:
        first?.path[0] === 'description'
          ? `Say what happened in a sentence (up to ${EVENT_DESCRIPTION_MAX} characters).`
          : first?.path[0] === 'occurred_on'
            ? 'Pick a date.'
            : SAVE_FAILED,
    };
  }
  const client = await getSessionClient();
  let id: string;
  try {
    id = await createEvent(client, user.id, parsed.data);
  } catch (err) {
    logger.warn('app.event.save_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: SAVE_FAILED };
  }
  logger.info('app.event.saved', { userId: user.id, objectType: 'life_event', objectId: id });

  let photo: 'none' | 'saved' | 'failed' = 'none';
  const file = formData.get('photo');
  if (file instanceof File && file.size > 0) {
    const alt = String(formData.get('alt_text') ?? '')
      .trim()
      .slice(0, EVENT_ALT_TEXT_MAX);
    const meta = photoSchema.safeParse({ type: file.type, size: file.size });
    if (!meta.success) photo = 'failed';
    else {
      try {
        const mediaId = randomUUID();
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.slice('image/'.length);
        const path = eventMediaStoragePath(user.id, id, mediaId, ext);
        await uploadEventMedia(path, new Uint8Array(await file.arrayBuffer()), file.type);
        await addEventMedia(client, {
          userId: user.id,
          eventId: id,
          storagePath: path,
          mimeType: file.type,
          sizeBytes: file.size,
          altText: alt || null,
        });
        photo = 'saved';
      } catch (err) {
        photo = 'failed';
        logger.warn('app.event.photo_failed', {
          userId: user.id,
          objectId: id,
          errorClass: errorClassOf(err),
        });
      }
    }
  }
  await queue('extract_event_metadata', { eventId: id, force: false }, user.id);
  await enqueueEmbedSafely('life_event', id, user.id, { delayMs: EMBED_AFTER_SAVE_DELAY_MS });
  track(user.id, 'life_event_logged', {
    about_reading: !!parsed.data.reading_id,
    with_photo: photo === 'saved',
  });
  revalidate(id, parsed.data.reading_id);
  return { ok: true, value: { id, photo } };
}

export async function setEventDateAction(eventId: unknown, date: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(eventId);
  const d = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(date);
  if (!id.success || !d.success) return { ok: false, message: 'Pick a date.' };
  try {
    const client = await getSessionClient();
    await setEventDate(client, id.data, d.data);
    // A moved date changes every proximity signal: re-score, and refresh its journeys.
    await queue('correlate_object', { objectType: 'life_event', objectId: id.data }, user.id);
    await refreshJourneys(await journeysOfObjects('life_event', [id.data]));
    logger.info('app.event.date_changed', { userId: user.id, objectId: id.data });
    revalidate(id.data);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.event.date_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

/** Soft delete now, purge by job (the same path readings take). */
export async function deleteEventAction(eventId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(eventId);
  if (!id.success) return { ok: false, message: FAILED };
  try {
    const client = await getSessionClient();
    const gone = await softDeleteEvent(client, id.data);
    if (!gone) return { ok: false, message: FAILED };
    await queue('purge_deleted', { eventId: id.data }, user.id);
    logger.info('app.event.deleted', {
      userId: user.id,
      objectType: 'life_event',
      objectId: id.data,
    });
    revalidate(id.data);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.event.delete_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

// ── Connections (FR-12, FR-13) ─────────────────────────────────────────────────────────────

/** A decided connection changes both retrieval documents ("Linked: …", Phase 09). */
async function embedBothSides(
  link: { from_type: string; from_id: string; to_type: string; to_id: string },
  userId: string,
) {
  for (const [t, i] of [
    [link.from_type, link.from_id],
    [link.to_type, link.to_id],
  ] as const)
    if (t === 'reading' || t === 'life_event') await enqueueEmbedSafely(t, i, userId);
}

/** Confirm · Maybe · Unrelated: one tap, one update, undoable. Journeys refresh on confirm. */
export async function linkAction(
  linkId: unknown,
  action: unknown,
): Promise<ActionResult<{ state: LinkAction }>> {
  const user = await requireUser();
  const id = uuid.safeParse(linkId);
  const a = z.enum(LINK_ACTIONS).safeParse(action);
  if (!id.success || !a.success) return { ok: false, message: FAILED };
  try {
    const client = await getSessionClient();
    const link = await actOnLink(client, id.data, a.data);
    logger.info('app.link.acted', { userId: user.id, linkId: id.data, state: a.data });
    track(user.id, 'link_decided', { decision: a.data });
    await embedBothSides(link, user.id);
    revalidate(link.to_type === 'life_event' ? link.to_id : undefined, link.from_id);
    return { ok: true, value: { state: a.data } };
  } catch (err) {
    logger.warn('app.link.act_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

export async function undoLinkActionAction(linkId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(linkId);
  if (!id.success) return { ok: false, message: FAILED };
  try {
    const client = await getSessionClient();
    const link = await undoLinkAction(client, id.data);
    logger.info('app.link.undone', { userId: user.id, linkId: id.data });
    await embedBothSides(link, user.id);
    revalidate(link.to_type === 'life_event' ? link.to_id : undefined, link.from_id);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.link.undo_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

// ── Outcomes (FR-14, FR-15) ────────────────────────────────────────────────────────────────

const outcomeSchema = z
  .object({
    readingId: uuid,
    predictionId: uuid.nullable().default(null),
    status: z.enum(OUTCOME_STATUSES),
    note: z.string().trim().max(OUTCOME_NOTE_MAX).nullable().default(null),
    /** Link an existing event, or create one inline from a sentence. */
    lifeEventId: uuid.nullable().default(null),
    newEvent: z.string().trim().min(1).max(EVENT_DESCRIPTION_MAX).nullable().default(null),
    occurredOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();

/**
 * Record what happened: the user's word alone (a model never writes one). Optionally
 * creates the life event it points at in the same action — the event is saved first, then
 * the outcome, then follow-up status and revisit date follow.
 */
export async function recordOutcomeAction(
  raw: unknown,
): Promise<ActionResult<{ outcomeId: string; eventId: string | null }>> {
  const user = await requireUser();
  const parsed = outcomeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: FAILED };
  const input = parsed.data;
  const client = await getSessionClient();
  try {
    const reading = await getReading(client, input.readingId);
    if (!reading) return { ok: false, message: FAILED };
    let eventId = input.lifeEventId;
    if (!eventId && input.newEvent) {
      eventId = await createEvent(client, user.id, {
        description: input.newEvent,
        occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
        note: null,
        reading_id: input.readingId,
      });
      logger.info('app.event.saved', {
        userId: user.id,
        objectType: 'life_event',
        objectId: eventId,
      });
      await queue('extract_event_metadata', { eventId, force: false }, user.id);
    }
    const memory = await getReadingMemory(client, reading);
    const open = memory.predictions.filter((p) => !p.dismissed_at).map((p) => p.id);
    const { id } = await recordOutcome(
      client,
      user.id,
      {
        readingId: input.readingId,
        predictionId: input.predictionId,
        lifeEventId: eventId,
        status: input.status,
        note: input.note,
      },
      { openPredictionIds: open },
    );
    await refreshJourneys(await journeysOfObjects('reading', [input.readingId]));
    // Phase 09: the reading's document carries its outcome; the event's its origin.
    await enqueueEmbedSafely('reading', input.readingId, user.id);
    if (eventId) await enqueueEmbedSafely('life_event', eventId, user.id);
    logger.info('app.outcome.recorded', {
      userId: user.id,
      objectType: 'reading',
      objectId: input.readingId,
      state: input.status,
    });
    track(user.id, 'outcome_recorded', { status: input.status });
    revalidate(eventId ?? undefined, input.readingId);
    return { ok: true, value: { outcomeId: id, eventId } };
  } catch (err) {
    logger.warn('app.outcome.failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}
