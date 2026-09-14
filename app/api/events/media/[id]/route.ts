import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { createEventMediaSignedUrl } from '@/db/admin';
import { getEventMedia } from '@/db/queries/events';

/** Signed URLs live this long: enough to render, not enough to share. */
export const MEDIA_URL_SECONDS = 300;

/**
 * Owner-scoped photo access (spec §6.4, §11). The `event_media` row is read through the
 * user client (RLS), and only then does the service role mint a short-lived signed URL for
 * its path. The bucket has no policies of its own, so this route is the only door.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });
  await requireUser();
  const media = await getEventMedia(await getSessionClient(), id);
  if (!media) return new NextResponse(null, { status: 404 });
  const url = await createEventMediaSignedUrl(media.storage_path, MEDIA_URL_SECONDS);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'cache-control': 'private, no-store' },
  });
}
