import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSessionClient, getUser } from '@/auth/session';
import { createExportSignedUrl } from '@/db/admin';
import { getExport } from '@/db/queries/exports';
import { logger } from '@/observability/logger';

export const dynamic = 'force-dynamic';

/** A signed download link lives this long; the archive itself for a week. */
export const SIGNED_URL_SECONDS = 10 * 60;

/**
 * Hands out a short-lived signed URL for one export archive (FR-22). Ownership is checked
 * through the user client (RLS): a row that is not the caller's simply does not exist. The
 * bucket is private and has no user policies, so this redirect is the only way in.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const row = await getExport(await getSessionClient(), id);
  if (!row || row.status !== 'ready' || !row.storage_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  const url = await createExportSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  logger.info('app.export.downloaded', { userId: user.id, objectType: 'export', objectId: id });
  return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'no-store' } });
}
