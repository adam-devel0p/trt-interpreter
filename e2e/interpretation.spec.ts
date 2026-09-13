import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { createReadyUser, expectNoSeriousA11y, signInViaUi, tabTo } from './_helpers';

/**
 * Phase 04: the interpretation arrives streaming after the save, is cached for good (reopening
 * makes no call — verified against `ai_calls`, the provider's own ledger), regenerates on
 * request and keeps the old row, folds and unfolds by keyboard, announces politely, handles a
 * high-stakes question with one calm resource card, nudges on the third repeated question, and
 * stays out of the way for a user who has not consented. Runs against the mock provider.
 */

const UUID = /\/reading\/[0-9a-f-]{36}/;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The provider spy: every model call lands in ai_calls, so counting rows counts calls. */
async function aiCalls(userId: string, task?: string) {
  let q = admin()
    .from('ai_calls')
    .select('id, task, status', { count: 'exact' })
    .eq('user_id', userId);
  if (task) q = q.eq('task', task);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function interpretationRows(readingId: string) {
  const { data, error } = await admin()
    .from('interpretations')
    .select('id, status, superseded_by, synthesis')
    .eq('reading_id', readingId)
    .order('created_at');
  if (error) throw error;
  return data as {
    id: string;
    status: string;
    superseded_by: string | null;
    synthesis: string | null;
  }[];
}

async function pickCard(page: Page, query: string) {
  const input = page.getByRole('combobox');
  await input.fill(query);
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await input.press('Enter');
}

/** A physical three-card RWS reading, saved. Returns the reading id. */
async function physicalReading(page: Page, question: string) {
  await page.goto('/reading/new');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you asking?');
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /Is this about a part of life\?|What are you asking\?/,
  );
  return page;
}

async function finishPhysical(page: Page, cards = ['strength', 'tower', 'ace of cups']) {
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: /Situation · Advice · Outcome/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Enter my physical cards/ }).click();
  for (const c of cards) await pickCard(page, c);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page).toHaveURL(UUID);
  return page.url().match(/reading\/([0-9a-f-]{36})/)![1]!;
}

test.describe('AI interpretation', () => {
  test('streams after the save, caches on reopen (no new call), regenerates on request and keeps the old row', async ({
    page,
  }) => {
    const user = await createReadyUser('interp', { aiConsent: true });
    await signInViaUi(page, user.email);
    await physicalReading(page, 'Should I take the job in Lisbon?');
    const readingId = await finishPhysical(page);

    const ai = page.locator('[data-ai-content="true"]');
    await expect(ai).toBeVisible();
    await expect(ai).toContainText('AI interpretation');
    await expect(ai).toContainText('suggested');
    // Layers arrive in order and the whole thing settles; the live region reports the stage.
    await expect(ai.getByRole('status')).toHaveText('Interpretation complete.', {
      timeout: 15_000,
    });
    await expect(ai).toContainText(/Taken together|suggest/);
    await expect(ai.getByText('Card by card')).toBeVisible();
    await expect(ai).toContainText('Situation — Strength');
    await expect(ai).toContainText('Read together');
    await expect(ai).toContainText('Questions to sit with');
    // The user's own words stay above, untouched, in their own treatment.
    await expect(page.getByRole('heading', { name: 'Your interpretation' })).toBeVisible();
    await expectNoSeriousA11y(page);

    expect(await aiCalls(user.id, 'interpret_reading')).toBe(1);
    expect(await aiCalls(user.id, 'classify_safety')).toBe(1);

    // Collapse and expand by keyboard.
    const cardByCard = ai.locator('summary', { hasText: 'Card by card' });
    await tabTo(page, cardByCard, 60);
    await page.keyboard.press('Enter');
    await expect(ai.getByText('Situation — Strength')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(ai.getByText('Situation — Strength')).toBeVisible();

    // Reopen: everything renders from the row, and the ledger does not move.
    await page.goto(`/reading/${readingId}`);
    await expect(ai).toContainText('Card by card');
    await expect(ai.getByRole('status')).toHaveText('Interpretation complete.');
    await page.waitForTimeout(500);
    expect(await aiCalls(user.id, 'interpret_reading')).toBe(1);

    // Feedback is a user write.
    await ai.getByRole('button', { name: 'Not really' }).click();
    await expect(ai.getByRole('status').filter({ hasText: 'Noted.' })).toBeVisible();

    // Regenerate: one more call, a new row, the old one kept and superseded.
    await ai.getByRole('button', { name: 'Regenerate' }).click();
    await expect(ai.getByRole('status').first()).toHaveText('Interpretation complete.', {
      timeout: 15_000,
    });
    await expect.poll(() => aiCalls(user.id, 'interpret_reading')).toBe(2);
    const rows = await interpretationRows(readingId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe('complete');
    expect(rows[0]!.superseded_by).toBe(rows[1]!.id);
    expect(rows[1]!.superseded_by).toBeNull();
    expect(rows[0]!.synthesis).not.toBeNull();
  });

  test('a high-stakes question still gets a reading plus one calm resource card; a benign one shows nothing', async ({
    page,
  }) => {
    const user = await createReadyUser('safety', { aiConsent: true });
    await signInViaUi(page, user.email);
    await physicalReading(page, 'Some days I want to end my life. Will it get better?');
    await finishPhysical(page);
    const ai = page.locator('[data-ai-content="true"]');
    await expect(ai.getByRole('status')).toHaveText('Interpretation complete.', {
      timeout: 15_000,
    });
    const card = page.locator('[data-safety-card]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('If things feel heavy right now');
    await expect(card).toContainText('Find a helpline');
    await expect(page.getByRole('main')).not.toContainText(/refuse|cannot read|will not/i);
    await expectNoSeriousA11y(page);
    // Reload: still exactly one card, nothing repeated.
    await page.reload();
    await expect(page.locator('[data-safety-card]')).toHaveCount(1);
    await expect(ai).toContainText('Card by card');

    await physicalReading(page, 'Should I repaint the kitchen this autumn?');
    await finishPhysical(page);
    await expect(page.locator('[data-ai-content="true"]').getByRole('status')).toHaveText(
      'Interpretation complete.',
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-safety-card]')).toHaveCount(0);
  });

  test('without consent: no call, an honest slot, the reading complete', async ({ page }) => {
    const user = await createReadyUser('noconsent', { aiConsent: false });
    await signInViaUi(page, user.email);
    await physicalReading(page, 'Should I take the job in Lisbon?');
    await finishPhysical(page);
    await expect(page.getByRole('main')).toContainText('AI interpretation is off.');
    await expect(page.getByRole('link', { name: 'Profile' }).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(await aiCalls(user.id)).toBe(0);
    await expect(page.getByRole('list', { name: 'Cards by position' })).toContainText('Strength');
  });

  test('repeated question: the third near-identical ask gets one nudge, "Draw anyway" continues', async ({
    page,
  }) => {
    const user = await createReadyUser('repeat', { aiConsent: true });
    await signInViaUi(page, user.email);
    const q = 'Will Sam call me back tonight?';
    for (let i = 0; i < 2; i++) {
      await physicalReading(page, q);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Is this about a part of life?',
      );
      await finishPhysical(page, ['star', 'moon', 'sun']);
    }
    await physicalReading(page, q);
    const nudge = page.getByRole('region', { name: 'You’ve asked this a few times today.' });
    await expect(nudge).toBeVisible();
    await expect(
      nudge.getByRole('list', { name: 'Earlier readings' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(nudge).not.toContainText(/streak|again\?!|stop/i);
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Draw anyway' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Is this about a part of life?',
    );
    await finishPhysical(page, ['star', 'moon', 'sun']);

    // Same cluster, same day: no second nudge.
    await physicalReading(page, q);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Is this about a part of life?',
    );
  });
});
