import { describe, expect, it } from 'vitest';
import {
  inQuietHours,
  localParts,
  pickReminder,
  type ReminderCandidate,
  type ReminderState,
} from '../rules';
import {
  BANNED_REMINDER_PHRASES,
  monthlyRetrospectiveCopy,
  revisitCopy,
  violatesReminderCopy,
  weeklyReflectionCopy,
} from '../copy';

const revisit: ReminderCandidate = {
  kind: 'revisit_due',
  fingerprint: 'revisit|r1|2026-09-01',
  objectType: 'reading',
  objectId: 'r1',
  path: '/reading/r1',
};
const monthly: ReminderCandidate = {
  kind: 'monthly_retrospective',
  fingerprint: 'retro|2026-08',
  objectType: 'period',
  objectId: null,
  path: '/retrospective/2026-08',
  promptFingerprint: 'retrospective|2026-08',
};
const weekly: ReminderCandidate = {
  kind: 'weekly_reflection',
  fingerprint: 'weekly|2026-W36',
  objectType: 'period',
  objectId: null,
  path: '/retrospective/2026-W36',
};

const state = (over: Partial<ReminderState> = {}): ReminderState => ({
  channel: 'push',
  switches: { revisit_reminders: true, weekly_reflection: true, monthly_retrospective: true },
  sent: new Set(),
  dismissed: new Set(),
  sentToday: false,
  localTime: '10:00',
  quietStart: null,
  quietEnd: null,
  ...over,
});

describe('quiet hours', () => {
  it('same-day and overnight windows, half-open; equal bounds mean none', () => {
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('14:00', '12:00', '14:00')).toBe(false);
    expect(inQuietHours('23:30', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('03:00', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('12:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('12:00', '09:00', '09:00')).toBe(false);
    expect(inQuietHours('12:00', null, '09:00')).toBe(false);
  });

  it('local parts follow the user’s zone', () => {
    const t = new Date('2026-09-14T23:30:00Z'); // Monday in UTC
    expect(localParts(t, 'UTC')).toEqual({
      date: '2026-09-14',
      time: '23:30',
      weekday: 1,
      dayOfMonth: 14,
    });
    expect(localParts(t, 'Asia/Tokyo')).toEqual({
      date: '2026-09-15',
      time: '08:30',
      weekday: 2,
      dayOfMonth: 15,
    });
    expect(localParts(t, 'Not/AZone').date).toBe('2026-09-14');
  });
});

describe('pickReminder()', () => {
  it('nothing without a channel; nothing when nothing is due', () => {
    expect(pickReminder([revisit], state({ channel: 'none' }))).toEqual({
      kind: 'none',
      reason: 'channel_off',
    });
    expect(pickReminder([], state())).toEqual({ kind: 'none', reason: 'nothing_due' });
  });

  it('a switched-off kind is skipped; sent fingerprints and in-app dismissals silence a candidate', () => {
    expect(
      pickReminder(
        [revisit, monthly],
        state({
          switches: {
            revisit_reminders: false,
            weekly_reflection: true,
            monthly_retrospective: true,
          },
        }),
      ),
    ).toMatchObject({ kind: 'send', candidate: monthly });
    expect(pickReminder([revisit], state({ sent: new Set([revisit.fingerprint]) }))).toEqual({
      kind: 'none',
      reason: 'nothing_due',
    });
    expect(
      pickReminder([monthly], state({ dismissed: new Set(['retrospective|2026-08']) })),
    ).toEqual({ kind: 'none', reason: 'nothing_due' });
  });

  it('priority: a due revisit beats the month, which beats the week', () => {
    expect(pickReminder([weekly, monthly, revisit], state())).toMatchObject({
      kind: 'send',
      candidate: revisit,
    });
    expect(pickReminder([weekly, monthly], state())).toMatchObject({
      kind: 'send',
      candidate: monthly,
    });
  });

  it('at most one a day and quiet hours hold a reminder rather than dropping it', () => {
    expect(pickReminder([revisit], state({ sentToday: true }))).toEqual({
      kind: 'hold',
      reason: 'daily_cap',
    });
    expect(
      pickReminder(
        [revisit],
        state({ localTime: '23:00', quietStart: '22:00', quietEnd: '07:00' }),
      ),
    ).toEqual({ kind: 'hold', reason: 'quiet_hours' });
    expect(
      pickReminder([revisit], state({ localTime: '09:00', quietStart: '22:00', quietEnd: '07:00' }))
        .kind,
    ).toBe('send');
  });
});

describe('reminder copy', () => {
  it('names a date or a count, links by id, and never uses streak or loss vocabulary', () => {
    const all = [
      revisitCopy({ occurredAt: '2026-03-30T10:00:00Z', deckName: 'Rider–Waite–Smith' }),
      monthlyRetrospectiveCopy({ monthLabel: 'August 2026', readings: 3, events: 1 }),
      monthlyRetrospectiveCopy({ monthLabel: 'August 2026', readings: 1, events: 0 }),
      weeklyReflectionCopy({ weekLabel: 'Week of 31 August 2026', entries: 4 }),
    ];
    for (const c of all) {
      expect(violatesReminderCopy(`${c.title} ${c.body}`)).toBeNull();
      expect(c.title.length).toBeLessThan(80);
    }
    expect(all[0]!.body).toMatch(/30 March 2026/);
    expect(all[1]!.body).toMatch(/3 readings and 1 life event/);
    expect(all[2]!.body).toMatch(/1 reading from August 2026/);
    expect(BANNED_REMINDER_PHRASES.length).toBeGreaterThan(8);
    expect(violatesReminderCopy("Don't lose your streak!")).not.toBeNull();
    expect(violatesReminderCopy('We miss you — come back')).not.toBeNull();
  });
});
