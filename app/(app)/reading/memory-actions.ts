'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { listEntities, type EntityListItem } from '@/db/queries/memory';
import { enqueue } from '@/jobs/enqueue';
import { applyCorrection } from '@/memory/corrections';
import { errorClassOf, logger } from '@/observability/logger';
import type { ActionResult } from './actions';

/**
 * Corrections to extracted metadata (FR-26) and the entity picker behind them. Every write is
 * one override row as the user, then a model-free re-materialisation; nothing here calls
 * `src/ai/`. A retry only *enqueues* — the cron batch runs it.
 */

const CORRECTION_FAILED = "That didn't save. The suggestion is unchanged — try again.";

export async function correctMetadataAction(
  readingId: unknown,
  correction: unknown,
): Promise<ActionResult<{ type: string }>> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(readingId);
  if (!id.success) return { ok: false, message: CORRECTION_FAILED };
  try {
    const { correction: type } = await applyCorrection(
      await getSessionClient(),
      user.id,
      id.data,
      correction,
    );
    logger.info('app.memory.corrected', {
      userId: user.id,
      objectType: 'reading',
      objectId: id.data,
      status: type,
    });
    revalidatePath(`/reading/${id.data}`);
    revalidatePath('/profile/entities');
    return { ok: true, value: { type } };
  } catch (err) {
    logger.warn('app.memory.correct_failed', {
      userId: user.id,
      objectId: id.data,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: CORRECTION_FAILED };
  }
}

/** Queue a fresh extraction (after a failure, or when the chips are stale). Never runs inline. */
export async function retryExtractionAction(readingId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(readingId);
  if (!id.success) return { ok: false, message: CORRECTION_FAILED };
  try {
    await enqueue(
      'extract_reading_metadata',
      { readingId: id.data, force: true },
      { userId: user.id, dedupe: true },
    );
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.memory.retry_failed', {
      userId: user.id,
      objectId: id.data,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: "Couldn't queue that. Try again in a moment." };
  }
}

/** The user's active entities, for "link to…" pickers. */
export async function listEntityOptionsAction(): Promise<ActionResult<EntityListItem[]>> {
  await requireUser();
  try {
    return { ok: true, value: await listEntities(await getSessionClient()) };
  } catch {
    return { ok: false, message: "Couldn't load your people and places." };
  }
}
