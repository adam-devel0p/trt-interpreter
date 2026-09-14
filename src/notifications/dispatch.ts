import 'server-only';
import { and, eq, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { track } from '@/analytics/track';
import { authAdmin, platformDb } from '@/db/admin';
import {
  decks,
  notifications,
  profiles,
  pushSubscriptions,
  readings,
  reminderSettings,
  retentionPrompts,
} from '@/db/schema';
import {
  monthlyRetrospectiveCopy,
  REMINDER_KIND_LABEL,
  revisitCopy,
  weeklyReflectionCopy,
  type ReminderCopy,
} from '@/domain/notifications/copy';
import {
  localParts,
  MONTHLY_RETROSPECTIVE_DAYS,
  pickReminder,
  WEEKLY_REFLECTION_DAYS,
  WEEKLY_REFLECTION_MIN_ENTRIES,
  type ReminderCandidate,
  type ReminderKind,
} from '@/domain/notifications/rules';
import { meetsSummaryFloor } from '@/domain/summaries/floors';
import { periodLabel, recentCompletePeriods } from '@/domain/summaries/periods';
import { logger } from '@/observability/logger';
import { listPeriodObjectIds } from '@/summaries/evidence';
import { openUrl, unsubscribeUrl } from './links';
import { getEmailSender, getPushSender, type PushMessage } from './senders';

/**
 * The reminder dispatcher (§15.2). For each user who chose a channel: gather what is due
 * (a revisit date that passed, a complete month above the floor in its first week, a
 * complete week with enough entries on its first days), let the pure rules pick one — or
 * hold it for quiet hours / the one-a-day cap — then send it and record it. Runs from the
 * `deliver_reminders` job, hourly by cron; every rule is deterministic so a re-run sends
 * nothing twice. No model call, no content in any message.
 */

export interface DispatchResult {
  usersSeen: number;
  sent: number;
  held: number;
  failed: number;
}

interface UserCtx {
  userId: string;
  timezone: string;
  channel: 'push' | 'email' | 'none';
  switches: {
    revisit_reminders: boolean;
    weekly_reflection: boolean;
    monthly_retrospective: boolean;
  };
  quietStart: string | null;
  quietEnd: string | null;
}

async function usersToConsider(userId: string | null): Promise<UserCtx[]> {
  const rows = await platformDb()
    .select({
      userId: reminderSettings.userId,
      timezone: profiles.timezone,
      channel: reminderSettings.channel,
      revisit: reminderSettings.revisitReminders,
      weekly: reminderSettings.weeklyReflection,
      monthly: reminderSettings.monthlyRetrospective,
      quietStart: reminderSettings.quietHoursStart,
      quietEnd: reminderSettings.quietHoursEnd,
    })
    .from(reminderSettings)
    .innerJoin(profiles, eq(profiles.id, reminderSettings.userId))
    .where(
      userId
        ? and(eq(reminderSettings.userId, userId), ne(reminderSettings.channel, 'none'))
        : ne(reminderSettings.channel, 'none'),
    )
    .orderBy(reminderSettings.userId);
  return rows.map((r) => ({
    userId: r.userId,
    timezone: r.timezone,
    channel: r.channel,
    switches: {
      revisit_reminders: r.revisit,
      weekly_reflection: r.weekly,
      monthly_retrospective: r.monthly,
    },
    quietStart: r.quietStart ? r.quietStart.slice(0, 5) : null,
    quietEnd: r.quietEnd ? r.quietEnd.slice(0, 5) : null,
  }));
}

type Candidate = ReminderCandidate & { copy: ReminderCopy };

async function candidatesFor(
  user: UserCtx,
  now: Date,
  local: ReturnType<typeof localParts>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  // Revisits whose date has passed and whose outcome is still open (FR-14).
  const due = await platformDb()
    .select({
      id: readings.id,
      occurredAt: readings.occurredAt,
      revisitAt: readings.revisitAt,
      deckName: decks.name,
    })
    .from(readings)
    .innerJoin(decks, eq(decks.id, readings.deckId))
    .where(
      and(
        eq(readings.userId, user.userId),
        isNull(readings.deletedAt),
        isNotNull(readings.revisitAt),
        lte(readings.revisitAt, now),
        inArray(readings.followUpStatus, ['unresolved', 'partly_resolved']),
      ),
    )
    .orderBy(readings.revisitAt)
    .limit(3);
  for (const r of due) {
    out.push({
      kind: 'revisit_due',
      fingerprint: `revisit|${r.id}|${r.revisitAt!.toISOString()}`,
      objectType: 'reading',
      objectId: r.id,
      path: `/reading/${r.id}`,
      copy: revisitCopy({ occurredAt: r.occurredAt.toISOString(), deckName: r.deckName }),
    });
  }
  // The month just finished, during its first week, only above the summary floor.
  if (local.dayOfMonth <= MONTHLY_RETROSPECTIVE_DAYS) {
    const [month] = recentCompletePeriods('monthly', local.date, 1);
    if (month) {
      const ids = await listPeriodObjectIds(user.userId, month);
      const readingsN = ids.readings.length;
      const eventsN = ids.events.length;
      if (meetsSummaryFloor('monthly', readingsN + eventsN))
        out.push({
          kind: 'monthly_retrospective',
          fingerprint: `retro|${month.key}`,
          objectType: 'period',
          objectId: null,
          path: `/retrospective/${month.key}`,
          promptFingerprint: `retrospective|${month.key}`,
          copy: monthlyRetrospectiveCopy({
            monthLabel: periodLabel(month),
            readings: readingsN,
            events: eventsN,
          }),
        });
    }
  }
  // The week just finished, on its first two days, only with enough entries in it.
  if (WEEKLY_REFLECTION_DAYS.includes(local.weekday)) {
    const [week] = recentCompletePeriods('weekly', local.date, 1);
    if (week) {
      const ids = await listPeriodObjectIds(user.userId, week);
      const entries = ids.readings.length + ids.events.length;
      if (entries >= WEEKLY_REFLECTION_MIN_ENTRIES)
        out.push({
          kind: 'weekly_reflection',
          fingerprint: `weekly|${week.key}`,
          objectType: 'period',
          objectId: null,
          path: `/retrospective/${week.key}`,
          copy: weeklyReflectionCopy({ weekLabel: periodLabel(week), entries }),
        });
    }
  }
  return out;
}

function emailBody(
  copy: ReminderCopy,
  kind: ReminderKind,
  open: string,
  unsubscribe: string,
): { text: string; html: string } {
  const label = REMINDER_KIND_LABEL[kind];
  const text = `${copy.title}\n\n${copy.body}\n\nOpen: ${open}\n\nTurn off ${label}: ${unsubscribe}\nAll reminder settings are in your profile.`;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p><strong>${esc(copy.title)}</strong></p><p>${esc(copy.body)}</p><p><a href="${esc(open)}">Open it</a></p><p style="color:#666;font-size:12px">You asked for ${esc(label)}. <a href="${esc(unsubscribe)}">Turn them off</a> with one tap, or change every reminder in your profile.</p>`;
  return { text, html };
}

async function deliver(user: UserCtx, c: Candidate, local: ReturnType<typeof localParts>) {
  const db = platformDb();
  const [row] = await db
    .insert(notifications)
    .values({
      userId: user.userId,
      kind: c.kind,
      channel: user.channel === 'email' ? 'email' : 'push',
      fingerprint: c.fingerprint,
      objectType: c.objectType,
      objectId: c.objectId,
      path: c.path,
      title: c.copy.title,
      body: c.copy.body,
      status: 'sent',
      sentOn: local.date,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (!row) return 'skipped' as const; // a parallel run got there first
  const open = openUrl(row.id, user.userId);
  const unsubscribe = unsubscribeUrl(user.userId, c.kind);
  let channel: 'push' | 'email' = user.channel === 'email' ? 'email' : 'push';
  let ok = false;
  let errorClass: string | null = null;

  if (channel === 'push') {
    const targets = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.userId), isNull(pushSubscriptions.disabledAt)));
    const message: PushMessage = {
      title: c.copy.title,
      body: c.copy.body,
      url: open,
      unsubscribeUrl: unsubscribe,
      tag: c.kind,
    };
    const sender = getPushSender();
    for (const t of targets) {
      const res = await sender.send(
        { endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth },
        message,
      );
      if (res.ok) {
        ok = true;
        await db
          .update(pushSubscriptions)
          .set({ lastSuccessAt: new Date() })
          .where(eq(pushSubscriptions.id, t.id));
      } else {
        errorClass = res.errorClass;
        if (res.gone)
          await db
            .update(pushSubscriptions)
            .set({ disabledAt: new Date() })
            .where(eq(pushSubscriptions.id, t.id));
      }
    }
    if (!ok) {
      // Email fallback: push was chosen but no device could be reached.
      channel = 'email';
      errorClass = targets.length === 0 ? 'no_push_subscription' : errorClass;
    }
  }
  if (channel === 'email' && !ok) {
    const { data } = await authAdmin().getUserById(user.userId);
    const to = data.user?.email ?? null;
    if (!to) {
      errorClass = 'no_email';
    } else {
      const body = emailBody(c.copy, c.kind, open, unsubscribe);
      const res = await getEmailSender().send({ to, subject: c.copy.title, ...body });
      ok = res.ok;
      if (!res.ok) errorClass = res.errorClass;
    }
  }
  await db
    .update(notifications)
    .set({ channel, status: ok ? 'sent' : 'failed', errorClass: ok ? null : errorClass })
    .where(eq(notifications.id, row.id));
  if (ok) track(user.userId, 'reminder_sent', { kind: c.kind, channel });
  logger.info('retention.reminder', {
    userId: user.userId,
    objectType: 'notification',
    objectId: row.id,
    kind: c.kind,
    status: ok ? `sent_${channel}` : 'failed',
    errorClass: ok ? undefined : (errorClass ?? undefined),
  });
  return ok ? ('sent' as const) : ('failed' as const);
}

export async function dispatchReminders(opts: {
  userId: string | null;
  now?: Date;
}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const out: DispatchResult = { usersSeen: 0, sent: 0, held: 0, failed: 0 };
  for (const user of await usersToConsider(opts.userId)) {
    out.usersSeen += 1;
    const local = localParts(now, user.timezone);
    const candidates = await candidatesFor(user, now, local);
    if (candidates.length === 0) continue;
    const db = platformDb();
    const [sentRows, prompts] = await Promise.all([
      db
        .select({ fingerprint: notifications.fingerprint, sentOn: notifications.sentOn })
        .from(notifications)
        .where(eq(notifications.userId, user.userId)),
      db
        .select({ fingerprint: retentionPrompts.fingerprint })
        .from(retentionPrompts)
        .where(
          and(eq(retentionPrompts.userId, user.userId), isNotNull(retentionPrompts.dismissedAt)),
        ),
    ]);
    const pick = pickReminder(candidates, {
      channel: user.channel,
      switches: user.switches,
      sent: new Set(sentRows.map((r) => r.fingerprint)),
      dismissed: new Set(prompts.map((p) => p.fingerprint)),
      sentToday: sentRows.some((r) => r.sentOn === local.date),
      localTime: local.time,
      quietStart: user.quietStart,
      quietEnd: user.quietEnd,
    });
    if (pick.kind === 'hold') {
      out.held += 1;
      continue;
    }
    if (pick.kind !== 'send') continue;
    const candidate = candidates.find((c) => c.fingerprint === pick.candidate.fingerprint)!;
    const result = await deliver(user, candidate, local);
    if (result === 'sent') out.sent += 1;
    else if (result === 'failed') out.failed += 1;
  }
  return out;
}
