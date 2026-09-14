import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/config/env.server';
import { clientEnv } from '@/config/env';

/**
 * Signed links carried inside a reminder (§15.2 "one-tap unsubscribe from the notification
 * itself"). A token binds a purpose, a user and a kind; nothing in it is content, and the
 * only thing a valid token can do is switch one reminder type off or mark one reminder
 * opened. No login is needed, which is the point of one tap.
 */
function secret(): string {
  const env = serverEnv();
  return env.NOTIFICATION_SIGNING_SECRET ?? env.JOBS_RUN_SECRET;
}

export function signToken(parts: string[]): string {
  return createHmac('sha256', secret()).update(parts.join('|')).digest('base64url');
}

export function verifyToken(parts: string[], token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(signToken(parts));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const base = () => clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

export function unsubscribeUrl(userId: string, kind: string): string {
  const t = signToken(['unsubscribe', userId, kind]);
  return `${base()}/api/notifications/unsubscribe?u=${encodeURIComponent(userId)}&k=${encodeURIComponent(kind)}&t=${t}`;
}

/** The deep link, via a redirect that records the open (§16 "return rate from reminders"). */
export function openUrl(notificationId: string, userId: string): string {
  const t = signToken(['open', notificationId, userId]);
  return `${base()}/api/notifications/open?n=${encodeURIComponent(notificationId)}&u=${encodeURIComponent(userId)}&t=${t}`;
}
