import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { track } from '@/analytics/track';
import { getSessionClient, getUser } from '@/auth/session';
import { buildReadingCard, parseShareOptions } from '@/domain/share/payload';
import { flag } from '@/flags';
import { loadArt, loadReadingForShare } from '@/share/load';
import { CARD_H, CARD_W, ReadingCard, shareFonts } from '@/share/render';

export const dynamic = 'force-dynamic';

/**
 * The reading share card as a PNG (FR-24). Rendered for the signed-in owner only (the data
 * is read through RLS), from the payload the options produce — the preview on the share
 * page is this very image. Private by default: no note, no question, no names unless the
 * query says so.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!(await flag('share_cards', { userId: user.id })))
    return new NextResponse(null, { status: 404 });
  const client = await getSessionClient();
  const reading = await loadReadingForShare(client, id);
  if (!reading) return new NextResponse(null, { status: 404 });
  const options = parseShareOptions(Object.fromEntries(new URL(req.url).searchParams));
  const payload = buildReadingCard(reading, options);
  const [art, fonts] = await Promise.all([
    loadArt(payload.cards.map((c) => c.artPath)),
    shareFonts(),
  ]);
  track(user.id, 'share_card_rendered', {
    kind: 'reading',
    question: options.question,
    notes: options.notes,
    entities: options.entities,
  });
  return new ImageResponse(<ReadingCard payload={payload} art={art} />, {
    width: CARD_W,
    height: CARD_H,
    fonts,
    headers: { 'cache-control': 'private, no-store' },
  });
}
