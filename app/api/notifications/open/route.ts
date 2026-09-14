import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { track } from '@/analytics/track';
import { platformDb } from '@/db/admin';
import { notifications } from '@/db/schema';
import { verifyToken } from '@/notifications/links';

export const dynamic = 'force-dynamic';

/**
 * The deep link inside a reminder: records the open (§16 "return rate from reminders"), then
 * sends the browser to the object the reminder was about. An invalid token still lands on
 * Home — a reminder link must never be a dead end.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const id = z.string().uuid().safeParse(q.get('n'));
  const userId = z.string().uuid().safeParse(q.get('u'));
  if (!id.success || !userId.success || !verifyToken(['open', id.data, userId.data], q.get('t')))
    return NextResponse.redirect(new URL('/home', req.url));
  const [row] = await platformDb()
    .update(notifications)
    .set({ openedAt: new Date() })
    .where(
      and(
        eq(notifications.id, id.data),
        eq(notifications.userId, userId.data),
        isNull(notifications.openedAt),
      ),
    )
    .returning({ path: notifications.path, kind: notifications.kind });
  const target =
    row?.path ??
    (
      await platformDb()
        .select({ path: notifications.path })
        .from(notifications)
        .where(and(eq(notifications.id, id.data), eq(notifications.userId, userId.data)))
        .limit(1)
    )[0]?.path ??
    '/home';
  if (row)
    track(userId.data, 'reminder_opened', {
      kind: row.kind as 'revisit_due' | 'weekly_reflection' | 'monthly_retrospective',
    });
  const safe = target.startsWith('/') && !target.startsWith('//') ? target : '/home';
  return NextResponse.redirect(new URL(safe, req.url));
}
