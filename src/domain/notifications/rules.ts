/**
 * Reminder rules (spec §15.2, §4.7). Pure: the dispatcher (`src/notifications/dispatch.ts`)
 * gathers candidates and state, this module decides. The rules, in order:
 *
 *   1. the user chose a channel (anything but `none`) — otherwise nothing is ever sent;
 *   2. the reminder's own switch is on;
 *   3. it has not been sent before (fingerprint) and its in-app twin was not dismissed;
 *   4. quiet hours (the user's local time) are respected — a reminder is held, not dropped;
 *   5. at most one reminder per local calendar day, whatever the kind;
 *   6. priority: a revisit that is due beats a month to look back on, which beats a week.
 *
 * Every reminder is anchored to one specific object with a deep link; there is no generic
 * "come back" reminder in this list and no streak anywhere.
 */

export const REMINDER_KINDS = [
  'revisit_due',
  'monthly_retrospective',
  'weekly_reflection',
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Priority order (index = priority). */
const PRIORITY: readonly ReminderKind[] = REMINDER_KINDS;

export interface ReminderCandidate {
  kind: ReminderKind;
  /** Once-only key: `revisit|<readingId>|<revisitAt>`, `retro|2026-08`, `weekly|2026-W33`. */
  fingerprint: string;
  objectType: 'reading' | 'period';
  objectId: string | null;
  /** In-app deep link. */
  path: string;
  /** What the retention prompt for the same thing would be fingerprinted as, if any. */
  promptFingerprint?: string;
}

export interface ReminderSwitches {
  revisit_reminders: boolean;
  weekly_reflection: boolean;
  monthly_retrospective: boolean;
}

export interface ReminderState {
  channel: 'push' | 'email' | 'none';
  switches: ReminderSwitches;
  /** Fingerprints already sent (any status). */
  sent: ReadonlySet<string>;
  /** Retention-prompt fingerprints the user dismissed in-app. */
  dismissed: ReadonlySet<string>;
  /** Whether any reminder already went out on the user's current local day. */
  sentToday: boolean;
  /** The user's local time of day and quiet window (both `HH:MM`), null = no quiet hours. */
  localTime: string;
  quietStart: string | null;
  quietEnd: string | null;
}

export const SWITCH_FOR_KIND: Readonly<Record<ReminderKind, keyof ReminderSwitches>> = {
  revisit_due: 'revisit_reminders',
  weekly_reflection: 'weekly_reflection',
  monthly_retrospective: 'monthly_retrospective',
};

/** `HH:MM` → minutes since midnight. */
export function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Inside `[start, end)`, wrapping past midnight (22:00–07:00). Equal bounds = no window. */
export function inQuietHours(localTime: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const t = minutesOf(localTime);
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export type PickOutcome =
  | { kind: 'send'; candidate: ReminderCandidate }
  | { kind: 'hold'; reason: 'quiet_hours' | 'daily_cap' }
  | { kind: 'none'; reason: 'channel_off' | 'nothing_due' };

/** The one reminder to send now, or why not. */
export function pickReminder(
  candidates: readonly ReminderCandidate[],
  state: ReminderState,
): PickOutcome {
  if (state.channel === 'none') return { kind: 'none', reason: 'channel_off' };
  const eligible = candidates
    .filter((c) => state.switches[SWITCH_FOR_KIND[c.kind]])
    .filter((c) => !state.sent.has(c.fingerprint))
    .filter((c) => !c.promptFingerprint || !state.dismissed.has(c.promptFingerprint))
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const candidate = eligible[0];
  if (!candidate) return { kind: 'none', reason: 'nothing_due' };
  if (state.sentToday) return { kind: 'hold', reason: 'daily_cap' };
  if (inQuietHours(state.localTime, state.quietStart, state.quietEnd))
    return { kind: 'hold', reason: 'quiet_hours' };
  return { kind: 'send', candidate };
}

/** Local `YYYY-MM-DD`, `HH:MM` and ISO weekday (1 = Monday) of an instant in a time zone. */
export function localParts(
  now: Date,
  timeZone: string,
): { date: string; time: string; weekday: number; dayOfMonth: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hour = parts.hour === '24' ? '00' : parts.hour!;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    weekday: weekdays.indexOf(parts.weekday!.slice(0, 3)) + 1,
    dayOfMonth: Number(parts.day),
  };
}

/** Weekly reflections are offered on the first two days of the ISO week, for the week before. */
export const WEEKLY_REFLECTION_DAYS: readonly number[] = [1, 2];
/** Monthly retrospectives are offered during the first seven days of the month, for the month before. */
export const MONTHLY_RETROSPECTIVE_DAYS = 7;
/** A week needs this many entries before it is worth a reflection (the weekly summary floor). */
export const WEEKLY_REFLECTION_MIN_ENTRIES = 3;
