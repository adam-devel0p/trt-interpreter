'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { dismissPrompt } from '@/db/queries/summaries';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Dismissing a retention surface (spec §15.2, §4.7): remembered for good on that
 * fingerprint — the same shift, review, month or day is never shown again. Runs as the
 * user; ids only in the log.
 */
export async function dismissInsightAction(
  promptId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await requireUser();
  if (!z.string().uuid().safeParse(promptId).success) return { ok: false, message: 'Not found.' };
  try {
    await dismissPrompt(await getSessionClient(), promptId);
    logger.info('retention.dismissed', { userId: user.id, objectId: promptId });
    revalidatePath('/home');
    return { ok: true };
  } catch (err) {
    logger.warn('retention.dismiss_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: "That didn't go through. Try again." };
  }
}
