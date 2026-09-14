'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import {
  acceptJourney,
  addReadingToJourney,
  closeJourney,
  confirmMember,
  createJourney,
  deleteJourney,
  dismissJourney,
  JOURNEY_TITLE_MAX,
  mergeJourneys,
  removeMember,
  renameJourney,
  reopenJourney,
  restoreMember,
  splitJourney,
  undoJourneyMerge,
  type MemberState,
} from '@/db/queries/journeys';
import { refreshJourneys } from '@/journeys/refresh';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Journey management (spec §6.5, FR-10). Every write runs as the user through RLS; merge and
 * split are one transaction each (`apply_journey_merge`, `apply_journey_split`); after a
 * write the affected journeys are refreshed (activity, status, progression) with rule code.
 * No model is called from here — naming is the cron's `propose_journey` job, and a rename
 * here pins the title against it. Logs carry ids only.
 */
export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const FAILED = "That didn't go through. Nothing changed — try again.";
const uuid = z.string().uuid();

function done(journeyIds: string[], readingId?: string, eventId?: string) {
  revalidatePath('/journey');
  revalidatePath('/home');
  revalidatePath('/journal');
  for (const id of journeyIds) revalidatePath(`/journey/${id}`);
  if (readingId) revalidatePath(`/reading/${readingId}`);
  if (eventId) revalidatePath(`/event/${eventId}`);
}

async function run<T = undefined>(
  event: string,
  fn: (
    client: Awaited<ReturnType<typeof getSessionClient>>,
    userId: string,
  ) => Promise<{ value?: T; journeyIds: string[]; readingId?: string; eventId?: string }>,
): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    const out = await fn(await getSessionClient(), user.id);
    await refreshJourneys(out.journeyIds);
    logger.info(`app.journey.${event}`, {
      userId: user.id,
      journeyId: out.journeyIds[0],
      objectId: out.readingId ?? out.eventId,
    });
    done(out.journeyIds, out.readingId, out.eventId);
    return { ok: true, value: out.value as T };
  } catch (err) {
    logger.warn(`app.journey.${event}_failed`, { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

const title = z.string().trim().min(1).max(JOURNEY_TITLE_MAX);

export async function acceptJourneyAction(journeyId: unknown): Promise<ActionResult> {
  const id = uuid.safeParse(journeyId);
  if (!id.success) return { ok: false, message: FAILED };
  return run('accepted', async (c) => {
    await acceptJourney(c, id.data);
    return { journeyIds: [id.data] };
  });
}

export async function dismissJourneyAction(journeyId: unknown): Promise<ActionResult> {
  const id = uuid.safeParse(journeyId);
  if (!id.success) return { ok: false, message: FAILED };
  return run('dismissed', async (c) => {
    await dismissJourney(c, id.data);
    return { journeyIds: [id.data] };
  });
}

export async function renameJourneyAction(
  journeyId: unknown,
  value: unknown,
): Promise<ActionResult> {
  const id = uuid.safeParse(journeyId);
  const t = title.safeParse(value);
  if (!id.success) return { ok: false, message: FAILED };
  if (!t.success)
    return { ok: false, message: `Give it a name (up to ${JOURNEY_TITLE_MAX} characters).` };
  return run('renamed', async (c) => {
    await renameJourney(c, id.data, t.data);
    return { journeyIds: [id.data] };
  });
}

export async function closeJourneyAction(
  journeyId: unknown,
  reopen = false,
): Promise<ActionResult> {
  const id = uuid.safeParse(journeyId);
  if (!id.success) return { ok: false, message: FAILED };
  return run(reopen ? 'reopened' : 'closed', async (c) => {
    if (reopen) await reopenJourney(c, id.data);
    else await closeJourney(c, id.data);
    return { journeyIds: [id.data] };
  });
}

export async function deleteJourneyAction(journeyId: unknown): Promise<ActionResult> {
  const id = uuid.safeParse(journeyId);
  if (!id.success) return { ok: false, message: FAILED };
  return run('deleted', async (c) => {
    await deleteJourney(c, id.data);
    return { journeyIds: [] };
  });
}

export async function createJourneyAction(
  value: unknown,
  readingIds: unknown = [],
  eventIds: unknown = [],
): Promise<ActionResult<{ id: string }>> {
  const t = title.safeParse(value);
  const ids = z.array(uuid).max(200).safeParse(readingIds);
  const eids = z.array(uuid).max(200).safeParse(eventIds);
  if (!t.success)
    return { ok: false, message: `Give it a name (up to ${JOURNEY_TITLE_MAX} characters).` };
  if (!ids.success || !eids.success) return { ok: false, message: FAILED };
  return run<{ id: string }>('created', async (c, userId) => {
    const id = await createJourney(c, userId, t.data, ids.data, eids.data);
    return { value: { id }, journeyIds: [id], readingId: ids.data[0], eventId: eids.data[0] };
  });
}

export async function addReadingToJourneyAction(
  journeyId: unknown,
  readingId: unknown,
  objectType: unknown = 'reading',
): Promise<ActionResult> {
  const j = uuid.safeParse(journeyId);
  const r = uuid.safeParse(readingId);
  const t = z.enum(['reading', 'life_event']).safeParse(objectType);
  if (!j.success || !r.success || !t.success) return { ok: false, message: FAILED };
  return run('member_added', async (c, userId) => {
    await addReadingToJourney(c, userId, j.data, r.data, t.data);
    return {
      journeyIds: [j.data],
      readingId: t.data === 'reading' ? r.data : undefined,
      eventId: t.data === 'life_event' ? r.data : undefined,
    };
  });
}

export async function confirmMemberAction(
  memberId: unknown,
  readingId?: unknown,
): Promise<ActionResult> {
  const m = uuid.safeParse(memberId);
  if (!m.success) return { ok: false, message: FAILED };
  const r = uuid.safeParse(readingId);
  return run('member_kept', async (c) => {
    const { journeyId } = await confirmMember(c, m.data);
    return { journeyIds: [journeyId], readingId: r.success ? r.data : undefined };
  });
}

/** Remove (or decline): returns the previous state so the client can offer undo. */
export async function removeMemberAction(
  memberId: unknown,
  readingId?: unknown,
): Promise<ActionResult<{ previous: MemberState }>> {
  const m = uuid.safeParse(memberId);
  if (!m.success) return { ok: false, message: FAILED };
  const r = uuid.safeParse(readingId);
  return run<{ previous: MemberState }>('member_removed', async (c) => {
    const { journeyId, previous } = await removeMember(c, m.data);
    return {
      value: { previous },
      journeyIds: [journeyId],
      readingId: r.success ? r.data : undefined,
    };
  });
}

export async function restoreMemberAction(
  memberId: unknown,
  previous: unknown,
  readingId?: unknown,
): Promise<ActionResult> {
  const m = uuid.safeParse(memberId);
  const s = z.enum(['auto', 'pending', 'confirmed']).safeParse(previous);
  if (!m.success || !s.success) return { ok: false, message: FAILED };
  const r = uuid.safeParse(readingId);
  return run('member_restored', async (c) => {
    const { journeyId } = await restoreMember(c, m.data, s.data);
    return { journeyIds: [journeyId], readingId: r.success ? r.data : undefined };
  });
}

export async function mergeJourneysAction(
  sourceId: unknown,
  targetId: unknown,
): Promise<ActionResult> {
  const s = uuid.safeParse(sourceId);
  const t = uuid.safeParse(targetId);
  if (!s.success || !t.success) return { ok: false, message: FAILED };
  return run('merged', async (c) => {
    await mergeJourneys(c, s.data, t.data);
    return { journeyIds: [t.data, s.data] };
  });
}

export async function undoMergeJourneysAction(sourceId: unknown): Promise<ActionResult> {
  const s = uuid.safeParse(sourceId);
  if (!s.success) return { ok: false, message: FAILED };
  return run('merge_undone', async (c) => {
    await undoJourneyMerge(c, s.data);
    return { journeyIds: [s.data] };
  });
}

export async function splitJourneyAction(
  sourceId: unknown,
  value: unknown,
  memberIds: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = uuid.safeParse(sourceId);
  const t = title.safeParse(value);
  const ids = z.array(uuid).min(1).max(200).safeParse(memberIds);
  if (!s.success || !ids.success) return { ok: false, message: FAILED };
  if (!t.success) return { ok: false, message: 'Give the new journey a name.' };
  return run<{ id: string }>('split', async (c) => {
    const id = await splitJourney(c, s.data, t.data, ids.data);
    return { value: { id }, journeyIds: [s.data, id] };
  });
}
