/**
 * Reminder copy (spec §15.2, §4.7, DESIGN_SYSTEM copy rules). Content-free by rule: a
 * reminder names a date or a count and links to the entry; it never quotes the question, a
 * note or a name (push text sits on lock screens; email passes a third party). No streaks,
 * no loss, no urgency — a test scans every string for that vocabulary.
 */
import type { ReminderKind } from './rules';

export interface ReminderCopy {
  title: string;
  body: string;
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function revisitCopy(input: { occurredAt: string; deckName: string }): ReminderCopy {
  return {
    title: 'A reading is ready to revisit',
    body: `You set a revisit date for a ${input.deckName} reading from ${longDate(input.occurredAt)}. Whether anything came of it is yours to say — "unresolved" is a fine answer.`,
  };
}

export function monthlyRetrospectiveCopy(input: {
  monthLabel: string;
  readings: number;
  events: number;
}): ReminderCopy {
  const parts = [
    `${input.readings} ${input.readings === 1 ? 'reading' : 'readings'}`,
    ...(input.events > 0
      ? [`${input.events} life ${input.events === 1 ? 'event' : 'events'}`]
      : []),
  ];
  return {
    title: `${input.monthLabel} is ready to look back on`,
    body: `${parts.join(' and ')} from ${input.monthLabel}, laid out with what you confirmed happened. Open it when you have a quiet minute.`,
  };
}

export function weeklyReflectionCopy(input: { weekLabel: string; entries: number }): ReminderCopy {
  return {
    title: `Last week, in ${input.entries} entries`,
    body: `The ${input.weekLabel.toLowerCase()} is complete. A short look at what recurred and what is still open, built from your own entries.`,
  };
}

export const REMINDER_KIND_LABEL: Readonly<Record<ReminderKind, string>> = {
  revisit_due: 'revisit reminders',
  weekly_reflection: 'weekly reflections',
  monthly_retrospective: 'monthly look-backs',
};

/** Vocabulary no reminder may use (§15.2 "avoid streaks", §4.7). */
export const BANNED_REMINDER_PHRASES: readonly RegExp[] = [
  /\bstreak/i,
  /\bdon'?t (lose|miss|break)\b/i,
  /\bmiss(ed|ing)? out\b/i,
  /\bhurry\b/i,
  /\blast chance\b/i,
  /\bonly \d+ (hours?|days?) left\b/i,
  /\bwe miss you\b/i,
  /\bcome back\b/i,
  /\bkeep (it|your) (up|going)\b/i,
  /\bbadge/i,
  /\breward/i,
  /\bdraw (again|another)\b/i,
];

export function violatesReminderCopy(text: string): string | null {
  const hit = BANNED_REMINDER_PHRASES.find((re) => re.test(text));
  return hit ? hit.source : null;
}
