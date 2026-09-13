import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import {
  authAdmin,
  exportStoragePath,
  platformDb,
  removeExportArchives,
  uploadExportArchive,
} from '@/db/admin';
import { exports_ } from '@/db/schema';
import { buildExportArchive } from '@/export/build';
import { errorClassOf } from '@/observability/logger';
import { defineJob } from '../types';

/** Archives are downloadable for a week, then swept the next time the user exports. */
export const EXPORT_TTL_MS = 7 * 86_400_000;

/**
 * Build and attach a user's export (FR-22). The payload names the `exports` row; the user id
 * is read from that row, so the job can never be pointed at someone else's data by a caller.
 * On failure the row says so (with a class, never a message) and the worker retries.
 */
export const exportUserDataPayload = z.object({ exportId: z.string().uuid() }).strict();

export const exportUserData = defineJob({
  kind: 'export_user_data',
  schema: exportUserDataPayload,
  async run(payload, ctx) {
    const db = platformDb();
    const [row] = await db
      .select()
      .from(exports_)
      .where(eq(exports_.id, payload.exportId))
      .limit(1);
    if (!row) {
      ctx.log.warn('jobs.export.missing_row', { objectId: payload.exportId });
      return;
    }
    if (row.status === 'ready' || row.status === 'expired') return;

    await db
      .update(exports_)
      .set({ status: 'running', jobId: ctx.jobId, errorClass: null })
      .where(eq(exports_.id, row.id));

    try {
      const { data } = await authAdmin().getUserById(row.userId);
      const built = await buildExportArchive(row.userId, { email: data.user?.email ?? null });
      const path = exportStoragePath(row.userId, row.id);
      await uploadExportArchive(path, built.bytes);
      const now = new Date();
      await db
        .update(exports_)
        .set({
          status: 'ready',
          storagePath: path,
          sizeBytes: built.bytes.byteLength,
          counts: built.manifest.counts,
          completedAt: now,
          expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        })
        .where(eq(exports_.id, row.id));
      ctx.log.info('jobs.export.ready', {
        userId: row.userId,
        objectType: 'export',
        objectId: row.id,
        count: built.bytes.byteLength,
      });
    } catch (err) {
      await db
        .update(exports_)
        .set({ status: 'failed', errorClass: errorClassOf(err) })
        .where(eq(exports_.id, row.id));
      throw err;
    }

    await sweepExpiredExports(row.userId);
  },
});

/** Remove archives past their `expires_at` for one user and mark the rows expired. */
export async function sweepExpiredExports(userId: string): Promise<number> {
  const db = platformDb();
  const stale = await db
    .select({ id: exports_.id, path: exports_.storagePath })
    .from(exports_)
    .where(
      and(
        eq(exports_.userId, userId),
        eq(exports_.status, 'ready'),
        lt(exports_.expiresAt, new Date()),
      ),
    );
  if (stale.length === 0) return 0;
  await removeExportArchives(stale.map((s) => s.path).filter((p): p is string => !!p));
  await db
    .update(exports_)
    .set({ status: 'expired', storagePath: null })
    .where(
      inArray(
        exports_.id,
        stale.map((s) => s.id),
      ),
    );
  return stale.length;
}
