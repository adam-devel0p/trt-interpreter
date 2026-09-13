'use server';

import { revalidatePath } from 'next/cache';
import { getSessionClient, requireUser } from '@/auth/session';
import {
  EXPORT_COOLDOWN_MS,
  hasPendingExport,
  listExports,
  requestExport,
} from '@/db/queries/exports';
import { enqueue } from '@/jobs/enqueue';
import { runBatch } from '@/jobs/worker';
import { errorClassOf, logger } from '@/observability/logger';
import { deleteAiArtifacts } from '@/privacy/aiArtifacts';

export type ProfileActionResult<T = undefined> =
  { ok: true; value: T } | { ok: false; message: string };

/**
 * Request an export (FR-22). Available on every plan (invariant 11). The row is inserted as
 * the user; the job reads the user id from the row, never from us. The job runs straight away
 * so the archive is usually ready by the time the page re-renders; the cron batch retries.
 */
export async function requestExportAction(): Promise<ProfileActionResult<{ id: string }>> {
  const user = await requireUser();
  const client = await getSessionClient();
  try {
    const recent = await listExports(client, 5);
    if (hasPendingExport(recent)) {
      return { ok: false, message: 'An export is already being prepared. Give it a moment.' };
    }
    const last = recent[0];
    if (last && Date.now() - new Date(last.requested_at).getTime() < EXPORT_COOLDOWN_MS) {
      return {
        ok: false,
        message: 'You exported a few minutes ago — that archive is still fresh. Try again later.',
      };
    }
    const id = await requestExport(client, user.id);
    logger.info('app.export.requested', { userId: user.id, objectType: 'export', objectId: id });
    try {
      const job = await enqueue('export_user_data', { exportId: id }, { userId: user.id });
      await runBatch({ jobId: job.id });
    } catch (err) {
      logger.warn('app.export.deferred', {
        userId: user.id,
        objectId: id,
        errorClass: errorClassOf(err),
      });
    }
    revalidatePath('/profile');
    return { ok: true, value: { id } };
  } catch (err) {
    logger.warn('app.export.request_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: "That didn't go through. Nothing changed — try again." };
  }
}

/** §10 user control: remove every AI artifact, keep every word the user wrote. */
export async function deleteAiArtifactsAction(): Promise<
  ProfileActionResult<{ counts: Record<string, number> }>
> {
  const user = await requireUser();
  const client = await getSessionClient();
  try {
    const { counts } = await deleteAiArtifacts(client, user.id);
    revalidatePath('/profile');
    revalidatePath('/journal');
    return { ok: true, value: { counts } };
  } catch (err) {
    logger.warn('app.ai_artifacts.delete_failed', {
      userId: user.id,
      errorClass: errorClassOf(err),
    });
    return {
      ok: false,
      message: "That didn't go through. Nothing was removed — try again.",
    };
  }
}
