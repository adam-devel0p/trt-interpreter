import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { track } from '@/analytics/track';
import { getSessionClient, getUser } from '@/auth/session';
import { buildMonthCard, parseShareOptions } from '@/domain/share/payload';
import { parsePeriodKey } from '@/domain/summaries/periods';
import { flag } from '@/flags';
import { loadMonthForShare } from '@/share/load';
import { CARD_H, CARD_W, MonthCard, shareFonts } from '@/share/render';

export const dynamic = 'force-dynamic';

/** "My month in tarot" as a PNG (§15.1): counts, recurring cards and themes; names only by choice. */
export async function GET(req: Request, ctx: { params: Promise<{ period: string }> }) {
  const { period: key } = await ctx.params;
  const period = parsePeriodKey(key);
  if (!period || period.kind !== 'monthly') return new NextResponse(null, { status: 404 });
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!(await flag('share_cards', { userId: user.id })))
    return new NextResponse(null, { status: 404 });
  const client = await getSessionClient();
  const month = await loadMonthForShare(client, period);
  if (month.readings === 0) return new NextResponse(null, { status: 404 });
  const options = parseShareOptions(Object.fromEntries(new URL(req.url).searchParams));
  const payload = buildMonthCard(month, options);
  track(user.id, 'share_card_rendered', {
    kind: 'month',
    question: false,
    notes: false,
    entities: options.entities || options.journeys,
  });
  return new ImageResponse(<MonthCard payload={payload} />, {
    width: CARD_W,
    height: CARD_H,
    fonts: await shareFonts(),
    headers: { 'cache-control': 'private, no-store' },
  });
}
