'use server';

import { track } from '@/analytics/track';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { deleteAsk, setAskFeedback } from '@/db/queries/asks';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Ask My History, the user's side of a stored ask (§16 feedback). Runs as the user through
 * RLS; never reaches `src/ai/`. Thumbs are one number and a timestamp, never words.
 */
export type ActionResult = { ok: true } | { ok: false; message: string };

const uuid = z.string().uuid();
const FAILED = "That didn't go through. Try again.";

export async function setAskFeedbackAction(
  askId: unknown,
  feedback: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(askId);
  const f = z.union([z.literal(1), z.literal(-1), z.null()]).safeParse(feedback);
  if (!id.success || !f.success) return { ok: false, message: FAILED };
  try {
    await setAskFeedback(await getSessionClient(), id.data, f.data);
    logger.info('app.ask.feedback', { userId: user.id, askId: id.data, state: String(f.data) });
    track(user.id, 'feedback_given', {
      target: 'ask',
      thumbs: f.data === 1 ? 'up' : f.data === -1 ? 'down' : 'cleared',
    });
    revalidatePath(`/ask/${id.data}`);
    return { ok: true };
  } catch (err) {
    logger.warn('app.ask.feedback_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

export async function deleteAskAction(askId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = uuid.safeParse(askId);
  if (!id.success) return { ok: false, message: FAILED };
  try {
    await deleteAsk(await getSessionClient(), id.data);
    logger.info('app.ask.deleted', { userId: user.id, askId: id.data });
    revalidatePath('/ask');
    return { ok: true };
  } catch (err) {
    logger.warn('app.ask.delete_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}
