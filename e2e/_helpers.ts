import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function expectNoSeriousA11y(page: Page) {
  // After a soft navigation Next applies <title> a tick later than the body; audit the settled page.
  await expect(page).toHaveTitle(/\S/);
  // Colour transitions are ≤ 250ms (tokens); a contrast check mid-transition samples a blend.
  await page.waitForTimeout(300);
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
export async function createReadyUser(
  tag: string,
  opts: { aiConsent?: boolean; extraction?: boolean; journeys?: boolean } = {},
) {
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
  // Phase 06: extraction is flag-gated (env default off); opt the test user in like a rollout.
  if (opts.extraction) {
    const flag = await admin
      .from('user_flags')
      .upsert(
        { user_id: data.user.id, flag: 'ai_extraction', enabled: true, set_by: 'rollout' },
        { onConflict: 'user_id,flag' },
      );
    if (flag.error) throw new Error(`flag upsert failed: ${flag.error.message}`);
  }
  // Phase 07: journeys are flag-gated the same way.
  if (opts.journeys) {
    const flag = await admin
      .from('user_flags')
      .upsert(
        { user_id: data.user.id, flag: 'journey_autocreate', enabled: true, set_by: 'rollout' },
        { onConflict: 'user_id,flag' },
      );
    if (flag.error) throw new Error(`flag upsert failed: ${flag.error.message}`);
  }
  return { id: data.user.id, email, password: PASSWORD };
}

/**
 * Run one cron batch (the queued extraction after a save). Same route Vercel cron calls;
 * the secret comes from .env.local.
 */
export async function runJobs(): Promise<{ claimed: number; succeeded: number }> {
  const base = process.env.PW_BASE_URL ?? 'http://127.0.0.1:3100';
  const secret = process.env.JOBS_RUN_SECRET;
  if (!secret) throw new Error('e2e needs JOBS_RUN_SECRET');
  const res = await fetch(`${base}/api/jobs/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`jobs run failed: ${res.status}`);
  return (await res.json()) as { claimed: number; succeeded: number };
}

export async function signInViaUi(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Service-role client for test setup only (never in app code). */
async function adminClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface SeedReadingSpec {
  deck: 'rws-classic' | 'thoth';
  /** Built-in spread slug; card count must match. */
  spread: 'one-card' | 'three-card' | 'situation-advice-outcome';
  cards: string[];
  question?: string | null;
  notes?: string | null;
  occurredAt?: string;
  source?: 'digital' | 'physical';
}

/**
 * Insert readings for a test user directly (Phase 05 journal specs need a few readings
 * without walking the flow each time). Same rows `create_reading()` would write.
 */
export async function seedReadings(userId: string, specs: SeedReadingSpec[]): Promise<string[]> {
  const admin = await adminClient();
  const ids: string[] = [];
  for (const spec of specs) {
    const deck = await admin.from('decks').select('id').eq('slug', spec.deck).single();
    const spread = await admin
      .from('spreads')
      .select('id, positions')
      .eq('slug', spec.spread)
      .is('user_id', null)
      .single();
    if (deck.error || spread.error) throw new Error('reference data missing — run pnpm db:seed');
    const deckId = (deck.data as { id: string }).id;
    const positions = (spread.data as { positions: { key: string }[] }).positions;
    const cards = await admin
      .from('cards')
      .select('id, slug')
      .eq('deck_id', deckId)
      .in('slug', spec.cards);
    const bySlug = new Map(
      (cards.data as { id: string; slug: string }[]).map((c) => [c.slug, c.id]),
    );
    const reading = await admin
      .from('readings')
      .insert({
        user_id: userId,
        question: spec.question ?? null,
        is_open_reflection: spec.question === null,
        spread_id: (spread.data as { id: string }).id,
        deck_id: deckId,
        source: spec.source ?? 'physical',
        uses_reversals: false,
        user_notes: spec.notes ?? null,
        occurred_at: spec.occurredAt ?? new Date().toISOString(),
      })
      .select('id')
      .single();
    if (reading.error) throw new Error(`seed reading failed: ${reading.error.message}`);
    const readingId = (reading.data as { id: string }).id;
    const rows = spec.cards.map((slug, i) => {
      const cardId = bySlug.get(slug);
      if (!cardId) throw new Error(`no card ${slug} in ${spec.deck}`);
      return {
        reading_id: readingId,
        user_id: userId,
        position_index: i,
        position_key: positions[i]?.key ?? `position_${i + 1}`,
        card_id: cardId,
        orientation: 'upright',
        sort_order: i,
      };
    });
    const ins = await admin.from('reading_cards').insert(rows);
    if (ins.error) throw new Error(`seed cards failed: ${ins.error.message}`);
    ids.push(readingId);
  }
  return ids;
}

/** Sign in as one of the `pnpm demo:seed` accounts. */
export async function signInAsDemo(page: Page, email: string) {
  await signInViaUi(page, email, 'demo-password-123');
}

/**
 * Queue the extraction the save action would have queued for readings inserted directly
 * (Phase 07 specs seed history, then let the cron batch extract and gather it).
 */
export async function enqueueExtractions(userId: string, readingIds: string[]): Promise<void> {
  const admin = await adminClient();
  const { error } = await admin.from('jobs').insert(
    readingIds.map((readingId) => ({
      kind: 'extract_reading_metadata',
      payload: { readingId, force: false },
      user_id: userId,
      max_attempts: 5,
    })),
  );
  if (error) throw new Error(`enqueue failed: ${error.message}`);
}
