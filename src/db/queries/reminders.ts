/**
 * Reminder delivery preferences as the user (RLS): channel, the three reminder switches,
 * quiet hours, and this device's push subscription. One `reminder_settings` row per user,
 * created on the first change (the Phase 10 in-app switches share it).
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';

export interface ReminderPrefs {
  channel: 'push' | 'email' | 'none';
  revisit_reminders: boolean;
  weekly_reflection: boolean;
  monthly_retrospective: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export const REMINDER_DEFAULTS: ReminderPrefs = {
  channel: 'none',
  revisit_reminders: true,
  weekly_reflection: false,
  monthly_retrospective: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
};

class ReminderReadError extends Error {
  override name = 'ReminderReadError';
}

export async function getReminderPrefs(client: UserClient): Promise<ReminderPrefs> {
  const { data, error } = await client
    .from('reminder_settings')
    .select(
      'channel, revisit_reminders, weekly_reflection, monthly_retrospective, quiet_hours_start, quiet_hours_end',
    )
    .maybeSingle();
  if (error) throw new ReminderReadError(error.message);
  const row = (data as Partial<ReminderPrefs> | null) ?? {};
  return {
    ...REMINDER_DEFAULTS,
    ...row,
    quiet_hours_start: row.quiet_hours_start ? row.quiet_hours_start.slice(0, 5) : null,
    quiet_hours_end: row.quiet_hours_end ? row.quiet_hours_end.slice(0, 5) : null,
  };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const reminderPatchSchema = z
  .object({
    channel: z.enum(['push', 'email', 'none']),
    revisit_reminders: z.boolean(),
    weekly_reflection: z.boolean(),
    monthly_retrospective: z.boolean(),
    quiet_hours_start: hhmm.nullable(),
    quiet_hours_end: hhmm.nullable(),
  })
  .partial()
  .strict();
export type ReminderPatch = z.infer<typeof reminderPatchSchema>;

export async function updateReminderPrefs(
  client: UserClient,
  userId: string,
  patch: ReminderPatch,
): Promise<void> {
  const clean = reminderPatchSchema.parse(patch);
  const { error } = await client
    .from('reminder_settings')
    .upsert({ user_id: userId, ...clean }, { onConflict: 'user_id' });
  if (error) throw new ReminderReadError(error.message);
}

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(256) }),
  })
  .strict();

export async function savePushSubscription(
  client: UserClient,
  userId: string,
  sub: z.infer<typeof pushSubscriptionSchema>,
): Promise<void> {
  const { error } = await client.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      disabled_at: null,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new ReminderReadError(error.message);
}

export async function removePushSubscription(client: UserClient, endpoint: string): Promise<void> {
  const { error } = await client.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw new ReminderReadError(error.message);
}

export async function listPushEndpoints(client: UserClient): Promise<string[]> {
  const { data, error } = await client
    .from('push_subscriptions')
    .select('endpoint')
    .is('disabled_at', null);
  if (error) throw new ReminderReadError(error.message);
  return ((data ?? []) as { endpoint: string }[]).map((r) => r.endpoint);
}

export interface RecentReminder {
  id: string;
  kind: string;
  channel: string;
  path: string;
  title: string;
  status: string;
  sent_at: string;
  opened_at: string | null;
}

export async function listRecentReminders(
  client: UserClient,
  limit = 5,
): Promise<RecentReminder[]> {
  const { data, error } = await client
    .from('notifications')
    .select('id, kind, channel, path, title, status, sent_at, opened_at')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw new ReminderReadError(error.message);
  return (data ?? []) as RecentReminder[];
}
