import { dispatchReminders } from '@/notifications/dispatch';
import { defineJob } from '../types';
import { deliverRemindersPayload } from './payloads';

/**
 * The reminder sweep (§15.2): one pass over every user who chose a channel — or one user —
 * sending at most one reminder each, subject to the rules in `domain/notifications/rules`.
 * Model-free. A cron entry runs it hourly (`pnpm jobs:reminders` locally).
 */
export const deliverRemindersJob = defineJob({
  kind: 'deliver_reminders',
  schema: deliverRemindersPayload,
  async run(payload, ctx) {
    const out = await dispatchReminders({ userId: payload.userId });
    ctx.log.info('jobs.deliver_reminders.ran', {
      attempts: out.usersSeen,
      count: out.sent,
      dropped: out.held,
      errorClass: out.failed ? `failed_${out.failed}` : undefined,
    });
  },
});
