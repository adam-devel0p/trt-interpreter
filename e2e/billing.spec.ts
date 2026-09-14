import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import Stripe from 'stripe';
import {
  createReadyUser,
  expectNoSeriousA11y,
  freshEmail,
  seedReadings,
  signInViaUi,
  signUpViaUi,
  tabTo,
} from './_helpers';

/**
 * Phase 11: money without hostages. A brand-new user reaches a saved, interpreted reading
 * and Home with no paywall anywhere (the spec fails if one renders); a premium action shows
 * the paywall at that action, the (fake) checkout grants the entitlement through the real
 * webhook handler, a replayed webhook changes nothing; cancelling from the portal leaves
 * the whole archive readable, searchable and exportable; the interpretation allowance ends
 * with honest copy and a working reading; the paywall sheet is focus-trapped and closes on
 * Escape, with price and trial terms as real text.
 */

const UUID = /\/reading\/[0-9a-f-]{36}/;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function subscriptionOf(userId: string) {
  const { data } = await admin()
    .from('subscriptions')
    .select('status, interval, trial_end, cancel_at, provider_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data as {
    status: string;
    interval: string;
    trial_end: string | null;
    cancel_at: string | null;
    provider_customer_id: string;
  } | null;
}

async function planOf(userId: string) {
  const { data } = await admin().from('profiles').select('plan').eq('id', userId).single();
  return (data as { plan: string }).plan;
}

const noPaywall = async (page: Page) => expect(page.locator('[data-paywall]')).toHaveCount(0);

async function pickCard(page: Page, query: string) {
  const input = page.getByRole('combobox');
  await input.fill(query);
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await input.press('Enter');
}

test.describe('billing', () => {
  test('a new user reaches a saved, interpreted reading and Home with no paywall rendered anywhere', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signUpViaUi(page, freshEmail('nopaywall'));
    await noPaywall(page);
    await tabTo(page, page.getByRole('button', { name: "Let's begin" }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'I use my own deck' }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'Skip' }));
    await page.keyboard.press('Enter');
    await noPaywall(page);
    await tabTo(page, page.getByRole('button', { name: 'Allow AI interpretation' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/reading\/new$/);
    await noPaywall(page);

    await page.getByLabel('Your question').fill('Should I take the job in Lisbon?');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /Situation · Advice · Outcome/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    for (const c of ['strength', 'tower', 'ace of cups']) await pickCard(page, c);
    await noPaywall(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    const ai = page.locator('[data-ai-content="true"]');
    await expect(ai.getByRole('status')).toHaveText('Interpretation complete.', {
      timeout: 20_000,
    });
    await noPaywall(page);
    await expect(page.locator('body')).not.toContainText(/Premium|trial|upgrade/i);
    await page.goto('/home');
    await noPaywall(page);
    await expect(page.locator('body')).not.toContainText(/Premium|trial|upgrade/i);
    await page.goto('/journal');
    await noPaywall(page);
  });

  test('premium action → paywall at the action → test checkout → entitled → replayed webhook is a no-op → cancel → archive intact', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await createReadyUser('billing', { aiConsent: true, ask: true });
    await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['the-star', 'two-of-cups', 'nine-of-wands'],
        question: 'Will Maya call?',
        notes: 'Private note.',
      },
      { deck: 'thoth', spread: 'one-card', cards: ['lust'], question: 'What now?' },
    ]);
    await signInViaUi(page, user.email);

    // Ask is premium: the paywall stands where the composer would, and says what it would do here.
    await page.goto('/ask');
    const card = page.getByTestId('paywall-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Ask my history searches all 2 of your readings');
    await expect(card).toContainText('a year');
    await expect(card).toContainText('a month');
    await expect(card).toContainText(/Free until \d+ \w+ \d{4}/);
    await expect(card).toContainText('cancel');
    await expect(card).not.toContainText(/hurry|last chance|only .* left|limited time/i);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expectNoSeriousA11y(page);

    // Annual is first and selected; the trial is stated; checkout is the fake provider's page.
    const radios = card.getByRole('radio');
    await expect(radios.first()).toBeChecked();
    await card.getByRole('button', { name: /Start 14 days free/ }).click();
    await expect(page).toHaveURL(/\/billing\/checkout\?/);
    await expect(page.getByText('Premium, yearly')).toBeVisible();
    await expect(page.getByText('14 days free first')).toBeVisible();
    await page.getByRole('button', { name: 'Complete test purchase' }).click();
    await expect(page).toHaveURL(/\/ask\?billing=success/);
    // Entitled: the composer is back, the row is trialing, the plan mirror moved.
    await expect(page.getByTestId('paywall-card')).toHaveCount(0);
    await expect(page.getByRole('textbox').first()).toBeVisible();
    const sub = (await subscriptionOf(user.id))!;
    expect(sub.status).toBe('trialing');
    expect(sub.interval).toBe('year');
    expect(sub.trial_end).not.toBeNull();
    expect(await planOf(user.id)).toBe('premium');

    // Profile says so in plain words, with the trial end date, and "Manage billing" is one tap away.
    await page.goto('/profile');
    const billing = page.locator('#billing');
    await expect(billing).toContainText(/Premium trial until \d+ \w+ \d{4}/);
    await expect(billing).toContainText('Your archive stays readable whatever the plan');
    await expect(billing.getByRole('button', { name: 'Manage billing' })).toBeVisible();

    // Webhook replay over HTTP: the same signed body twice → applied once, then duplicate.
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_fake_secret_0123456789';
    await page.waitForTimeout(2000); // the event must post-date the checkout's own events
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: `evt_e2e_${user.id.slice(0, 8)}_${now}`,
      object: 'event',
      type: 'customer.subscription.updated',
      created: now,
      data: {
        object: {
          id: `sub_fake_${user.id.replace(/-/g, '').slice(0, 14)}`,
          object: 'subscription',
          customer: sub.provider_customer_id,
          status: 'active',
          trial_end: null,
          cancel_at: null,
          canceled_at: null,
          metadata: { user_id: user.id },
          items: {
            object: 'list',
            data: [
              {
                id: 'si_x',
                current_period_end: now + 365 * 86_400,
                price: { id: 'p', recurring: { interval: 'year' } },
              },
            ],
          },
        },
      },
    });
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
    const first = await request.post('/api/billing/webhook', {
      data: body,
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    });
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ outcome: 'applied' });
    const replay = await request.post('/api/billing/webhook', {
      data: body,
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ outcome: 'duplicate' });
    const forged = await request.post('/api/billing/webhook', {
      data: body,
      headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
    });
    expect(forged.status()).toBe(400);
    expect((await subscriptionOf(user.id))!.status).toBe('active');

    // Cancel: the portal (fake), one tap. Then the archive: journal, search, detail, edit, export.
    await page.goto('/profile');
    await billing.getByRole('button', { name: 'Manage billing' }).click();
    await expect(page).toHaveURL(/\/billing\/portal\?/);
    await page.getByRole('button', { name: 'Cancel now' }).click();
    await expect(page).toHaveURL(/\/profile/);
    expect((await subscriptionOf(user.id))!.status).toBe('canceled');
    expect(await planOf(user.id)).toBe('free');
    await expect(page.locator('#billing')).toContainText(
      'Your earlier subscription ended; everything you wrote is still here',
    );

    await page.goto('/journal');
    await expect(page.getByText('Will Maya call?')).toBeVisible();
    await expect(page.getByText('What now?')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search your readings' }).fill('Maya');
    await expect(page.getByText('Will Maya call?')).toBeVisible();
    await page.getByText('Will Maya call?').click();
    await expect(page).toHaveURL(UUID);
    await expect(page.getByText('Private note.')).toBeVisible();
    await page.getByLabel('In your own words').fill('Private note. Still mine after cancelling.');
    await page.getByLabel('In your own words').blur();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.goto('/profile');
    await page.locator('#export').getByRole('button', { name: 'Export' }).click();
    await expect(page.locator('#export')).toContainText(/Preparing your export|Ready|Download/i, {
      timeout: 20_000,
    });
    // And Ask is a paywall again — the earlier answers section would still list any stored asks.
    await page.goto('/ask');
    await expect(page.getByTestId('paywall-card')).toBeVisible();
    // A used trial is not offered twice.
    await expect(page.getByTestId('paywall-card')).not.toContainText('Free until');
    await expect(
      page.getByTestId('paywall-card').getByRole('button', { name: /Subscribe for a year/ }),
    ).toBeVisible();
  });

  test('the interpretation allowance: at the limit the reading saves, the copy is honest, nothing stored is touched; the sheet is keyboard-safe', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('limit', { aiConsent: true });
    const day = new Date().toISOString().slice(0, 10);
    const { error } = await admin().from('usage_counters').insert({
      user_id: user.id,
      period_start: day,
      task: 'interpret_reading',
      calls: 10,
      tokens: 0,
      cost_micros: 0,
    });
    if (error) throw new Error(error.message);
    await signInViaUi(page, user.email);
    await page.goto('/reading/new');
    await page.getByLabel('Your question').fill('Eleventh this month?');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /Situation · Advice · Outcome/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    for (const c of ['strength', 'tower', 'ace of cups']) await pickCard(page, c);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    const ai = page.getByRole('region', { name: 'AI interpretation' });
    await expect(ai).toContainText('No new interpretation this time — your reading is saved.', {
      timeout: 20_000,
    });
    await expect(ai).toContainText('Free includes 10 interpretations a month and you have used 10');
    await expect(ai).toContainText('stay readable');
    await expect(ai).not.toContainText(/hurry|last chance|unlock now/i);
    // The reading itself is complete: cards and reference meanings are on the page.
    await expect(page.getByText('Strength').first()).toBeVisible();
    // No provider call was made for the interpretation.
    const { count } = await admin()
      .from('ai_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('task', 'interpret_reading');
    expect(count ?? 0).toBe(0);
    await expectNoSeriousA11y(page);

    // Profile: usage is shown honestly; the sheet opens from "See Premium", traps focus, closes on Escape.
    await page.goto('/profile');
    await expect(page.locator('#billing')).toContainText('10 of 10 used');
    await page.locator('#billing').getByRole('button', { name: 'See Premium' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('a year');
    await expect(sheet.getByRole('radio').first()).toBeChecked();
    // Tab cycles inside the dialog.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(inside).toBe(true);
    await expectNoSeriousA11y(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(
      page.locator('#billing').getByRole('button', { name: 'See Premium' }),
    ).toBeFocused();
  });
});
