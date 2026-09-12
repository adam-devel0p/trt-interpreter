import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function expectNoSeriousA11y(page: Page) {
  // After a soft navigation Next applies <title> a tick later than the body; audit the settled page.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

export const freshEmail = (tag: string) => `e2e-${tag}-${randomUUID().slice(0, 8)}@test.local`;
export const PASSWORD = 'e2e-password-123';

/** Keyboard-only: press Tab until the locator is focused (bounded), never click. */
export async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Sign up through the UI (keyboard only) and land on onboarding step 1. */
export async function signUpViaUi(page: Page, email: string) {
  await page.goto('/sign-up');
  await tabTo(page, page.getByLabel('Email'));
  await page.keyboard.type(email);
  await tabTo(page, page.getByLabel('Password', { exact: true }));
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/onboarding$/);
}

/** Read the latest Mailpit message for an address and return the first Supabase verify link. */
export async function latestEmailLink(to: string): Promise<string> {
  const base = process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324';
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const list = (await res.json()) as { messages: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${base}/api/v1/message/${id}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const body = `${msg.Text}\n${msg.HTML}`;
      const match = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/);
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email with a verify link for ${to}`);
}

/**
 * A user who has already finished onboarding, created through the admin API (service role,
 * test-only). Returns credentials; sign in through the UI with `signInViaUi`.
 */
export async function createReadyUser(tag: string, opts: { aiConsent?: boolean } = {}) {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = freshEmail(tag);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const now = new Date().toISOString();
  const upd = await admin
    .from('profiles')
    .update({
      onboarding_step: 4,
      onboarding_completed_at: now,
      ai_consent_at: opts.aiConsent ? now : null,
    })
    .eq('id', data.user.id);
  if (upd.error) throw new Error(`profile update failed: ${upd.error.message}`);
  return { id: data.user.id, email, password: PASSWORD };
}

export async function signInViaUi(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}
