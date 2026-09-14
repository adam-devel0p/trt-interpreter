import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { track } from '@/analytics/track';
import { platformDb } from '@/db/admin';
import { reminderSettings } from '@/db/schema';
import { REMINDER_KINDS, SWITCH_FOR_KIND } from '@/domain/notifications/rules';
import { verifyToken } from '@/notifications/links';
import { logger } from '@/observability/logger';

export const dynamic = 'force-dynamic';

/**
 * One-tap unsubscribe from a reminder's own link (§15.2). The signed token authorises exactly
 * one thing — switching one reminder type off for one user — so no session is needed. The
 * response is a plain page that says what happened and where to turn it back on.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const userId = z.string().uuid().safeParse(q.get('u'));
  const kind = z.enum(REMINDER_KINDS).safeParse(q.get('k'));
  if (
    !userId.success ||
    !kind.success ||
    !verifyToken(['unsubscribe', userId.data, kind.data], q.get('t'))
  )
    return NextResponse.redirect(new URL('/notifications/unsubscribed?status=invalid', req.url));
  const column = SWITCH_FOR_KIND[kind.data];
  await platformDb()
    .update(reminderSettings)
    .set({
      revisitReminders: column === 'revisit_reminders' ? false : undefined,
      weeklyReflection: column === 'weekly_reflection' ? false : undefined,
      monthlyRetrospective: column === 'monthly_retrospective' ? false : undefined,
    })
    .where(eq(reminderSettings.userId, userId.data));
  track(userId.data, 'reminder_unsubscribed', { kind: kind.data, from: 'notification' });
  logger.info('retention.unsubscribed', { userId: userId.data, kind: kind.data });
  return NextResponse.redirect(
    new URL(`/notifications/unsubscribed?status=ok&kind=${kind.data}`, req.url),
  );
}
