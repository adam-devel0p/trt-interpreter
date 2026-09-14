import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeAdmin, platformDb, platformSql } from '@/db/admin';
import {
  notifications,
  pushSubscriptions,
  readings,
  reminderSettings,
  retentionPrompts,
} from '@/db/schema';
import { dispatchReminders } from '@/notifications/dispatch';
import { signToken, unsubscribeUrl } from '@/notifications/links';
import { setSendersForTests, type EmailMessage, type PushMessage } from '@/notifications/senders';
import { seedReferenceData } from '@/db/seed/reference';
import { violatesReminderCopy } from '@/domain/notifications/copy';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';

/**
 * Reminders against Postgres (phase 11 test plan): quiet hours hold; one per day; each
 * links to the right object; a disabled type stops; the unsubscribe link switches one type
 * off without a session; push falls back to email when no device can be reached; a gone
 * endpoint is disabled; nothing ever goes to a user without a channel; no copy carries a
 * question, a note or a name.
 */
describe('reminders (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;
  const pushes: { target: string; message: PushMessage }[] = [];
  const emails: EmailMessage[] = [];
  let pushOutcome: { ok: true } | { ok: false; gone: boolean; errorClass: string } = { ok: true };

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('reminders');
    refs = await loadJournalRefs(user);
    setSendersForTests(
      {
        id: 'spy',
        async send(target, message) {
          pushes.push({ target: target.endpoint, message });
          return pushOutcome;
        },
      },
      {
        id: 'spy',
        async send(message) {
          emails.push(message);
          return { ok: true };
        },
      },
    );
  });
  afterAll(async () => {
    setSendersForTests();
    await deleteTestUser(user);
    await closeAdmin();
  });
  beforeEach(async () => {
    pushes.length = 0;
    emails.length = 0;
    pushOutcome = { ok: true };
    await platformDb().delete(notifications).where(eq(notifications.userId, user.id));
    await platformDb().delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    await platformSql()`update readings set revisit_at = null where user_id = ${user.id}`;
    await platformSql()`update profiles set timezone = 'UTC' where id = ${user.id}`;
    await platformSql()`
      insert into reminder_settings (user_id, channel, revisit_reminders, weekly_reflection, monthly_retrospective, quiet_hours_start, quiet_hours_end)
      values (${user.id}, 'email', true, false, false, null, null)
      on conflict (user_id) do update set channel = 'email', revisit_reminders = true, weekly_reflection = false,
        monthly_retrospective = false, quiet_hours_start = null, quiet_hours_end = null`;
  });

  const settings = () =>
    platformDb()
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.userId, user.id))
      .then((r) => r[0]!);
  const sent = () =>
    platformDb().select().from(notifications).where(eq(notifications.userId, user.id));

  it('a due revisit is sent once, deep-links to the reading, and is content-free; a second run sends nothing', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Will Maya call about the flat?',
      notes: 'Private note about Dad.',
    });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${reading.id}`;
    const at = new Date('2026-09-14T10:00:00Z');
    const first = await dispatchReminders({ userId: user.id, now: at });
    expect(first).toMatchObject({ usersSeen: 1, sent: 1, held: 0, failed: 0 });
    const rows = await sent();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'revisit_due',
      channel: 'email',
      status: 'sent',
      objectType: 'reading',
      objectId: reading.id,
      path: `/reading/${reading.id}`,
      sentOn: '2026-09-14',
    });
    expect(emails).toHaveLength(1);
    const mail = emails[0]!;
    expect(mail.to).toBe(user.email);
    for (const text of [mail.subject, mail.text, mail.html, rows[0]!.title, rows[0]!.body]) {
      expect(text).not.toContain('Maya');
      expect(text).not.toContain('flat');
      expect(text).not.toContain('Dad');
      expect(violatesReminderCopy(text)).toBeNull();
    }
    expect(mail.text).toContain(`/api/notifications/open?n=${rows[0]!.id}`);
    expect(mail.text).toContain(unsubscribeUrl(user.id, 'revisit_due'));
    // Same day, same state: nothing more.
    const again = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-14T15:00:00Z'),
    });
    expect(again.sent).toBe(0);
    expect(await sent()).toHaveLength(1);
  });

  it('quiet hours hold a reminder; the next run outside them sends it; then the day cap holds a second one', async () => {
    const a = await makeReading(user, refs, { question: 'One?' });
    const b = await makeReading(user, refs, { question: 'Two?' });
    await platformSql()`update readings set revisit_at = now() - interval '2 days' where id in (${a.id}, ${b.id})`;
    await platformSql()`update reminder_settings set quiet_hours_start = '22:00', quiet_hours_end = '08:00' where user_id = ${user.id}`;
    await platformSql()`update profiles set timezone = 'Europe/Berlin' where id = ${user.id}`;
    // 06:30 Berlin (04:30Z): quiet.
    const held = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-15T04:30:00Z'),
    });
    expect(held).toMatchObject({ sent: 0, held: 1 });
    expect(await sent()).toHaveLength(0);
    // 09:00 Berlin: sent — the older revisit first.
    const morning = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-15T07:00:00Z'),
    });
    expect(morning.sent).toBe(1);
    const rows = await sent();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sentOn).toBe('2026-09-15');
    // Same local day: the second due reading waits.
    const later = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-15T18:00:00Z'),
    });
    expect(later).toMatchObject({ sent: 0, held: 1 });
    // Next day: it goes.
    const next = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-16T07:00:00Z'),
    });
    expect(next.sent).toBe(1);
    expect(new Set((await sent()).map((r) => r.objectId))).toEqual(new Set([a.id, b.id]));
  });

  it('a disabled kind stops it; no channel stops everything; the unsubscribe token flips one switch and nothing else', async () => {
    const reading = await makeReading(user, refs, { question: 'Three?' });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${reading.id}`;
    await platformSql()`update reminder_settings set revisit_reminders = false where user_id = ${user.id}`;
    expect(
      (await dispatchReminders({ userId: user.id, now: new Date('2026-09-17T10:00:00Z') })).sent,
    ).toBe(0);
    await platformSql()`update reminder_settings set revisit_reminders = true, channel = 'none' where user_id = ${user.id}`;
    expect(
      (await dispatchReminders({ userId: user.id, now: new Date('2026-09-17T10:00:00Z') }))
        .usersSeen,
    ).toBe(0);
    // The signed link: a wrong token does nothing, the right one turns exactly that kind off.
    await platformSql()`update reminder_settings set channel = 'email', weekly_reflection = true where user_id = ${user.id}`;
    const url = new URL(unsubscribeUrl(user.id, 'revisit_due'));
    expect(url.pathname).toBe('/api/notifications/unsubscribe');
    expect(url.searchParams.get('t')).toBe(signToken(['unsubscribe', user.id, 'revisit_due']));
    expect(signToken(['unsubscribe', user.id, 'weekly_reflection'])).not.toBe(
      url.searchParams.get('t'),
    );
    const { GET } = await import('../../../app/api/notifications/unsubscribe/route');
    const { NextRequest } = await import('next/server');
    const bad = await GET(
      new NextRequest(`http://localhost${url.pathname}?u=${user.id}&k=revisit_due&t=forged`),
    );
    expect(bad.headers.get('location')).toContain('status=invalid');
    expect((await settings()).revisitReminders).toBe(true);
    const good = await GET(new NextRequest(`http://localhost${url.pathname}${url.search}`));
    expect(good.headers.get('location')).toContain('status=ok&kind=revisit_due');
    const after = await settings();
    expect(after.revisitReminders).toBe(false);
    expect(after.weeklyReflection).toBe(true);
    expect(after.channel).toBe('email');
  });

  it('push: delivered to every live device; a gone endpoint is disabled; with no device it falls back to email', async () => {
    const reading = await makeReading(user, refs, { question: 'Four?' });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${reading.id}`;
    await platformSql()`update reminder_settings set channel = 'push' where user_id = ${user.id}`;
    // No device yet: email.
    await dispatchReminders({ userId: user.id, now: new Date('2026-09-18T10:00:00Z') });
    expect(emails).toHaveLength(1);
    expect(pushes).toHaveLength(0);
    expect((await sent())[0]).toMatchObject({ channel: 'email', status: 'sent' });
    // A device, a new due reading, next day: push, with the open and unsubscribe links in the payload.
    await platformDb()
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: `https://push.example/${user.id}`,
        p256dh: 'k',
        auth: 'a',
      });
    const second = await makeReading(user, refs, { question: 'Five?' });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${second.id}`;
    await dispatchReminders({ userId: user.id, now: new Date('2026-09-19T10:00:00Z') });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.message.url).toContain('/api/notifications/open?n=');
    expect(pushes[0]!.message.unsubscribeUrl).toBe(unsubscribeUrl(user.id, 'revisit_due'));
    expect(emails).toHaveLength(1);
    // The endpoint goes away: disabled, and the reminder still reaches the user by email.
    pushOutcome = { ok: false, gone: true, errorClass: 'http_410' };
    const third = await makeReading(user, refs, { question: 'Six?' });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${third.id}`;
    await dispatchReminders({ userId: user.id, now: new Date('2026-09-20T10:00:00Z') });
    expect(emails).toHaveLength(2);
    const [device] = await platformDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    expect(device!.disabledAt).not.toBeNull();
    const rows = await sent();
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'email', 'push']);
  });

  it('month and week reminders: only above the floor, only in their window, deep-linked to the retrospective, silenced by an in-app dismissal', async () => {
    await platformDb().delete(readings).where(eq(readings.userId, user.id));
    await platformSql()`update reminder_settings set monthly_retrospective = true, weekly_reflection = true where user_id = ${user.id}`;
    // Five readings in August 2026 → the month meets its floor; the week of 31 Aug–6 Sep has three.
    for (const day of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-28']) {
      const r = await makeReading(user, refs, { question: `August ${day}?` });
      await platformSql()`update readings set occurred_at = ${`${day}T12:00:00Z`} where id = ${r.id}`;
    }
    for (const day of ['2026-08-31', '2026-09-02', '2026-09-05']) {
      const r = await makeReading(user, refs, { question: `Week ${day}?` });
      await platformSql()`update readings set occurred_at = ${`${day}T12:00:00Z`} where id = ${r.id}`;
    }
    // 2 September (a Wednesday): the month is in its first week; the week is not on its first days.
    const sep2 = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-02T10:00:00Z'),
    });
    expect(sep2.sent).toBe(1);
    expect((await sent())[0]).toMatchObject({
      kind: 'monthly_retrospective',
      path: '/retrospective/2026-08',
    });
    // Monday 7 September: the week reminder for W36, the month one already sent.
    const sep7 = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-07T10:00:00Z'),
    });
    expect(sep7.sent).toBe(1);
    expect((await sent()).map((r) => r.path).sort()).toEqual([
      '/retrospective/2026-08',
      '/retrospective/2026-W36',
    ]);
    // 10 September: past the month's window and the week's days; nothing due.
    expect(
      (await dispatchReminders({ userId: user.id, now: new Date('2026-09-10T10:00:00Z') })).sent,
    ).toBe(0);
    // A month with a dismissed in-app card is never pushed: simulate October for September's 3 readings — below the floor anyway —
    // so instead dismiss August's prompt and re-run a fresh user state to prove the silence.
    await platformDb().delete(notifications).where(eq(notifications.userId, user.id));
    await platformDb()
      .insert(retentionPrompts)
      .values({
        userId: user.id,
        kind: 'retrospective',
        fingerprint: 'retrospective|2026-08',
        payload: { period: '2026-08' },
        shownOn: '2026-09-01',
        dismissedAt: new Date(),
      });
    const silenced = await dispatchReminders({
      userId: user.id,
      now: new Date('2026-09-02T10:00:00Z'),
    });
    expect(silenced.sent).toBe(0);
    await platformDb().delete(retentionPrompts).where(eq(retentionPrompts.userId, user.id));
  });

  it('the open link records the open once and redirects to the object; a forged token lands on Home', async () => {
    const reading = await makeReading(user, refs, { question: 'Seven?' });
    await platformSql()`update readings set revisit_at = now() - interval '1 day' where id = ${reading.id}`;
    await dispatchReminders({ userId: user.id, now: new Date('2026-09-21T10:00:00Z') });
    const [row] = await sent();
    const { GET } = await import('../../../app/api/notifications/open/route');
    const { NextRequest } = await import('next/server');
    const t = signToken(['open', row!.id, user.id]);
    const res = await GET(
      new NextRequest(`http://localhost/api/notifications/open?n=${row!.id}&u=${user.id}&t=${t}`),
    );
    expect(res.headers.get('location')).toBe(`http://localhost/reading/${reading.id}`);
    const [opened] = await sent();
    expect(opened!.openedAt).not.toBeNull();
    const again = await GET(
      new NextRequest(`http://localhost/api/notifications/open?n=${row!.id}&u=${user.id}&t=${t}`),
    );
    expect(again.headers.get('location')).toBe(`http://localhost/reading/${reading.id}`);
    const forged = await GET(
      new NextRequest(`http://localhost/api/notifications/open?n=${row!.id}&u=${user.id}&t=nope`),
    );
    expect(forged.headers.get('location')).toBe('http://localhost/home');
    // The row a user reads back through RLS carries no content.
    const own = await user.client
      .from('notifications')
      .select('title, body')
      .eq('id', row!.id)
      .single();
    expect(`${own.data!.title} ${own.data!.body}`).not.toContain('Seven');
  });
});
