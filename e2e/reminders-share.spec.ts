import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import {
  createReadyUser,
  expectNoSeriousA11y,
  runJobs,
  seedReadings,
  signInViaUi,
} from './_helpers';

/**
 * Phase 11: reminders and share cards through the UI. Reminders: the channel starts off;
 * a due revisit becomes one reminder (email, logged) that deep-links to the reading; the
 * Profile switch stops the kind; the reminder's own unsubscribe link works without a
 * session; no reminder copy contains the question. Share: the studio's preview is the
 * server-rendered image, private by default, and opting the question in changes the image
 * request and nothing else.
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function enqueueSweep(userId: string) {
  const { error } = await admin()
    .from('jobs')
    .insert({ kind: 'deliver_reminders', payload: { userId }, user_id: userId, max_attempts: 1 });
  if (error) throw new Error(error.message);
}

test.describe('reminders', () => {
  test('off by default; one due revisit → one logged email reminder that links to the reading; the switch and the unsubscribe link both stop it', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('reminders', { aiConsent: false });
    const [readingId] = await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['the-star'],
        question: 'Will Maya call about the flat?',
        occurredAt: '2026-06-01T10:00:00Z',
        revisitAt: '2026-08-01T10:00:00Z',
      },
    ]);
    await signInViaUi(page, user.email);

    // Nothing is sent to a user who never chose a channel.
    await enqueueSweep(user.id);
    await runJobs();
    let { data: none } = await admin().from('notifications').select('id').eq('user_id', user.id);
    expect(none).toHaveLength(0);

    await page.goto('/profile');
    const section = page.locator('#reminders');
    await expect(section).toContainText('never during quiet hours');
    await expect(section).not.toContainText(/streak/i);
    await expect(page.getByTestId('reminder-channel')).toHaveValue('none');
    await page.getByTestId('reminder-channel').selectOption('email');
    await expect(section).toContainText('Dates and counts only');
    await expectNoSeriousA11y(page);

    await enqueueSweep(user.id);
    await runJobs();
    const { data: sent } = await admin()
      .from('notifications')
      .select('id, kind, channel, path, title, body, status')
      .eq('user_id', user.id);
    expect(sent).toHaveLength(1);
    const n = sent![0] as {
      id: string;
      kind: string;
      channel: string;
      path: string;
      title: string;
      body: string;
      status: string;
    };
    expect(n).toMatchObject({
      kind: 'revisit_due',
      channel: 'email',
      status: 'sent',
      path: `/reading/${readingId}`,
    });
    expect(`${n.title} ${n.body}`).not.toContain('Maya');
    expect(`${n.title} ${n.body}`).not.toContain('flat');
    expect(n.body).toContain('1 June 2026');

    // The profile lists it and links to the reading.
    await page.goto('/profile');
    await expect(page.locator('#reminders')).toContainText('Recent reminders');
    await page.locator('#reminders').getByRole('link', { name: n.title }).click();
    await expect(page).toHaveURL(`/reading/${readingId}`);

    // Switch the kind off: a second due reading gets nothing.
    await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['the-sun'],
        question: 'Second?',
        occurredAt: '2026-06-02T10:00:00Z',
        revisitAt: '2026-08-02T10:00:00Z',
      },
    ]);
    await page.goto('/profile');
    await page.getByTestId('reminder-revisit_reminders').click();
    await expect(page.getByTestId('reminder-revisit_reminders')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await enqueueSweep(user.id);
    await runJobs();
    ({ data: none } = await admin().from('notifications').select('id').eq('user_id', user.id));
    expect(none).toHaveLength(1);

    // Back on; the one-tap link from a reminder turns it off again without a session.
    await page.getByTestId('reminder-revisit_reminders').click();
    await expect(page.getByTestId('reminder-revisit_reminders')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const { createHmac } = await import('node:crypto');
    const secret = process.env.NOTIFICATION_SIGNING_SECRET ?? process.env.JOBS_RUN_SECRET!;
    const token = createHmac('sha256', secret)
      .update(['unsubscribe', user.id, 'revisit_due'].join('|'))
      .digest('base64url');
    const res = await request.get(
      `/api/notifications/unsubscribe?u=${user.id}&k=revisit_due&t=${token}`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain(
      '/notifications/unsubscribed?status=ok&kind=revisit_due',
    );
    await page.goto('/notifications/unsubscribed?status=ok&kind=revisit_due');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turned off.');
    await expect(page.getByText(/revisit reminders any more/)).toBeVisible();
    await expectNoSeriousA11y(page);
    await page.goto('/profile');
    await expect(page.getByTestId('reminder-revisit_reminders')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const forged = await request.get(
      `/api/notifications/unsubscribe?u=${user.id}&k=weekly_reflection&t=${token}`,
      { maxRedirects: 0 },
    );
    expect(forged.headers()['location']).toContain('status=invalid');
  });
});

test.describe('share cards', () => {
  test('private by default: the preview is the server image, no question in the default request; opting in changes exactly that', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('share', { aiConsent: false, share: true });
    const [readingId] = await seedReadings(user.id, [
      {
        deck: 'thoth',
        spread: 'three-card',
        cards: ['lust', 'the-universe', 'princess-of-disks'],
        question: 'Should I tell Sam about Leeds?',
        notes: 'Private: I am not ready.',
      },
    ]);
    await signInViaUi(page, user.email);
    await page.goto(`/reading/${readingId}`);
    await page.getByRole('link', { name: 'Share as an image' }).click();
    await expect(page).toHaveURL(`/reading/${readingId}/share`);
    const preview = page.getByTestId('share-preview');
    await expect(preview).toHaveAttribute('src', `/api/share/reading/${readingId}`);
    await expect(page.getByTestId('share-opt-question')).not.toBeChecked();
    await expect(page.getByTestId('share-opt-notes')).not.toBeChecked();
    await expect(page.getByTestId('share-studio')).toContainText('off unless you switch it on');
    await expectNoSeriousA11y(page);
    // The default image really renders and is a PNG.
    const img = await page.request.get(`/api/share/reading/${readingId}`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
    expect((await img.body()).subarray(0, 4).toString('hex')).toBe('89504e47');
    // Opt the question in: the request changes by exactly that flag.
    await page.getByTestId('share-opt-question').check();
    await expect(preview).toHaveAttribute('src', `/api/share/reading/${readingId}?question=1`);
    await page.getByTestId('share-opt-question').uncheck();
    await expect(preview).toHaveAttribute('src', `/api/share/reading/${readingId}`);
    // Download is a real button; the file is fetched with the session (no public URL exists).
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image' }).click();
    expect((await download).suggestedFilename()).toMatch(/^tarot-reading-\d{4}-\d{2}-\d{2}\.png$/);
    // Someone else's session cannot render it.
    const other = await createReadyUser('share-other', { share: true });
    const ctx = await page.context().browser()!.newContext();
    const p2 = await ctx.newPage();
    await signInViaUi(p2, other.email);
    const denied = await p2.request.get(`/api/share/reading/${readingId}`);
    expect(denied.status()).toBe(404);
    await ctx.close();
  });
});
