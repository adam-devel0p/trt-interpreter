'use server';

import { revalidatePath } from 'next/cache';
import { track } from '@/analytics/track';
import { getSessionClient, requireUser } from '@/auth/session';
import {
  pushSubscriptionSchema,
  reminderPatchSchema,
  removePushSubscription,
  savePushSubscription,
  updateReminderPrefs,
} from '@/db/queries/reminders';
import { errorClassOf, logger } from '@/observability/logger';
import type { ProfileActionResult } from './actions';

/**
 * Reminder preferences (§15.2): channel, the three switches, quiet hours, and this device's
 * push registration. Everything runs as the user through RLS; nothing here reads the journal.
 */
export async function updateReminderPrefsAction(patch: unknown): Promise<ProfileActionResult> {
  const user = await requireUser();
  const parsed = reminderPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, message: 'Unknown setting.' };
  try {
    await updateReminderPrefs(await getSessionClient(), user.id, parsed.data);
    for (const [k, v] of Object.entries(parsed.data)) {
      logger.info('retention.reminder_setting_changed', {
        userId: user.id,
        flag: k,
        enabled: typeof v === 'boolean' ? v : v !== null && v !== 'none',
      });
      if (
        v === false &&
        (k === 'revisit_reminders' || k === 'weekly_reflection' || k === 'monthly_retrospective')
      )
        track(user.id, 'reminder_unsubscribed', {
          kind: k === 'revisit_reminders' ? 'revisit_due' : k,
          from: 'profile',
        });
    }
    revalidatePath('/profile');
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('retention.reminder_setting_failed', {
      userId: user.id,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: "That didn't save. Try again." };
  }
}

export async function savePushSubscriptionAction(sub: unknown): Promise<ProfileActionResult> {
  const user = await requireUser();
  const parsed = pushSubscriptionSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, message: 'This browser gave an unusable subscription.' };
  try {
    const client = await getSessionClient();
    await savePushSubscription(client, user.id, parsed.data);
    await updateReminderPrefs(client, user.id, { channel: 'push' });
    logger.info('retention.push_registered', { userId: user.id });
    revalidatePath('/profile');
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('retention.push_register_failed', {
      userId: user.id,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: "That didn't save. Try again." };
  }
}

export async function removePushSubscriptionAction(
  endpoint: unknown,
): Promise<ProfileActionResult> {
  const user = await requireUser();
  if (typeof endpoint !== 'string') return { ok: false, message: 'Unknown device.' };
  try {
    await removePushSubscription(await getSessionClient(), endpoint);
    logger.info('retention.push_removed', { userId: user.id });
    revalidatePath('/profile');
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('retention.push_remove_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: "That didn't go through. Try again." };
  }
}
