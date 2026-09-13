import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { createReadyUser, expectNoSeriousA11y, runJobs, signInViaUi, tabTo } from './_helpers';

/**
 * Phase 06 at 390px: save a reading → the queued extraction runs (one cron batch) → inferred
 * chips appear, each labelled "suggested" in text with a "why?" → correct a theme, dismiss
 * a person → reload: the corrections persist → the entities page lists who was found →
 * merge two entries → the reading shows the merged name → undo restores. The user's words
 * never change; every control is keyboard-reachable; the merge announces its outcome.
 */

const UUID = /\/reading\/[0-9a-f-]{36}/;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function pickCard(page: Page, query: string) {
  const input = page.getByRole('combobox');
  await input.fill(query);
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await input.press('Enter');
}

async function saveReading(page: Page, question: string, note: string) {
  await page.goto('/reading/new');
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: /Situation · Advice · Outcome/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Enter my physical cards/ }).click();
  for (const c of ['strength', 'tower', 'ace of cups']) await pickCard(page, c);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('What I notice').fill(note);
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page).toHaveURL(UUID);
  return page.url().match(/reading\/([0-9a-f-]{36})/)![1]!;
}

test.describe('structured memory', () => {
  test('save → chips → correct → persist → merge → undo, with the words untouched', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('memory', { aiConsent: true, extraction: true });
    await signInViaUi(page, user.email);

    // A reading that mentions a partner by descriptor, a place, and a worry.
    const readingId = await saveReading(
      page,
      'Should I take the job in Lisbon?',
      'My girlfriend thinks I should. Worried about the review either way.',
    );
    const panel = page.locator('[data-memory-panel]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Suggested by AI');
    // Until the queued job runs the panel says it is looking (unless a parallel worker's cron
    // batch already claimed the job — the same thing production's cron does every minute).
    await expect(panel).toHaveAttribute('data-state', /waiting|ready/);
    const notesBefore = await page.getByRole('textbox', { name: /In your own words/ }).inputValue();

    // The cron batch runs the queued extraction (never in the request path).
    await runJobs();
    await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(panel).toContainText('Themes');
    await expect(panel.getByText('suggested', { exact: true }).first()).toBeVisible();
    await expect(panel).toContainText('Decision');
    await expect(panel).toContainText('Anxiety');
    await expect(panel).toContainText('Lisbon');
    await expect(panel).toContainText(/my girlfriend/i);
    await expect(page.getByRole('textbox', { name: /In your own words/ })).toHaveValue(notesBefore);
    // Every "why?" opens with reasons in plain sentences.
    const why = panel.getByRole('button', { name: 'Why am I seeing this?' }).first();
    await tabTo(page, why, 80);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Why this was suggested')).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoSeriousA11y(page);

    // Correct a theme (dismiss) and keep another; dismiss the place.
    const themes = panel.getByRole('region', { name: 'Themes' });
    const people = panel.getByRole('region', { name: 'People and places' });
    const anxiety = themes
      .locator('span', { hasText: 'Anxiety' })
      .filter({ has: page.getByRole('button', { name: 'Dismiss suggestion' }) })
      .first();
    await anxiety.getByRole('button', { name: 'Dismiss suggestion' }).click();
    await expect(themes).not.toContainText('Anxiety');
    await expect(panel.getByRole('status').first()).toHaveText('Anxiety dismissed.');
    const decision = themes
      .locator('span', { hasText: 'Decision' })
      .filter({ has: page.getByRole('button', { name: 'Keep this suggestion' }) })
      .first();
    await decision.getByRole('button', { name: 'Keep this suggestion' }).click();
    await expect(themes.locator('span', { hasText: 'Decision' }).first()).toContainText('you');
    const lisbon = people
      .locator('span', { hasText: 'Lisbon' })
      .filter({ has: page.getByRole('button', { name: 'Dismiss suggestion' }) })
      .first();
    await lisbon.getByRole('button', { name: 'Dismiss suggestion' }).click();
    await expect(people).not.toContainText('Lisbon');

    // Reload: the corrections persisted (overrides), the words are the same.
    await page.reload();
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await expect(themes).not.toContainText('Anxiety');
    await expect(people).not.toContainText('Lisbon');
    await expect(themes.locator('span', { hasText: 'Decision' }).first()).toContainText('you');
    await expect(page.getByRole('textbox', { name: /In your own words/ })).toHaveValue(notesBefore);
    const { data: reading } = await admin()
      .from('readings')
      .select('user_notes, question')
      .eq('id', readingId)
      .single();
    expect(reading).toEqual({
      question: 'Should I take the job in Lisbon?',
      user_notes: 'My girlfriend thinks I should. Worried about the review either way.',
    });
    // Model calls: exactly one extraction for this user (plus the interpretation's two).
    const { count } = await admin()
      .from('ai_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('task', 'extract_reading_metadata');
    expect(count).toBe(1);

    // A second reading names the partner: the same entity, renamed.
    const secondId = await saveReading(
      page,
      'How do I talk to Alex about the move?',
      'Alex, my girlfriend, went quiet again.',
    );
    await runJobs();
    const panel2 = page.locator('[data-memory-panel]');
    await expect(panel2).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(panel2).toContainText('Alex');
    expect(secondId).not.toBe(readingId);

    // Entities page: one Alex (was "my girlfriend"), a partner. Create a duplicate by hand
    // through the picker ("someone new"), then merge it back and undo.
    await page.goto('/profile/entities');
    await expect(page.getByRole('heading', { name: 'People & places' })).toBeVisible();
    const alexLink = page.getByRole('link', { name: /^Alex/ });
    await expect(alexLink).toHaveCount(1);
    await expect(page.getByRole('main')).toContainText('Partner');
    await expectNoSeriousA11y(page);

    await page.goto(`/reading/${secondId}`);
    const people2 = panel2.getByRole('region', { name: 'People and places' });
    await expect(people2).toContainText('Alex · as “my girlfriend”');
    const alexChip = people2
      .locator('span')
      .filter({ has: page.getByRole('link', { name: 'Alex', exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'link…' }) })
      .first();
    await alexChip.getByRole('button', { name: 'link…' }).click();
    const picker = page.getByRole('combobox', { name: /Who is Alex/ });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option', { hasText: 'Someone new' })).toBeAttached();
    await picker.selectOption('__new');
    await expect(
      people2
        .locator('span')
        .filter({ has: page.getByRole('link', { name: 'Alex', exact: true }) })
        .first(),
    ).toContainText('you');

    await page.goto('/profile/entities');
    await expect(page.getByRole('link', { name: /^Alex/ })).toHaveCount(2);
    // Open the confirmed one (the new entry) and merge it into the other.
    await page
      .getByRole('link', { name: /^Alex.*confirmed by you/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alex' })).toBeVisible();
    await expectNoSeriousA11y(page);
    const target = page.getByLabel(/Merge “Alex” into/);
    await target.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Merge “Alex” into “Alex”?');
    await dialog.getByRole('button', { name: 'Merge' }).click();
    await expect(page).toHaveURL(/\/profile\/entities\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('status').filter({ hasText: 'merged into this one' }),
    ).toBeVisible();
    // Both readings now point at the surviving entry.
    await expect(page.getByRole('main')).toContainText('How do I talk to Alex about the move?');
    await expect(page.getByRole('main')).toContainText('Should I take the job in Lisbon?');
    await page.goto('/profile/entities');
    await expect(page.getByRole('link', { name: /^Alex/ })).toHaveCount(1);

    // Undo the merge: two entries again.
    await page.getByRole('link', { name: /^Alex/ }).click();
    await page.getByRole('button', { name: /Undo merge from/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'merged into this one' })).toHaveCount(
      0,
    );
    await page.goto('/profile/entities');
    await expect(page.getByRole('link', { name: /^Alex/ })).toHaveCount(2);

    // The journal can filter by entity.
    await page.goto('/journal');
    await page.getByRole('button', { name: 'Filters' }).click();
    const mentions = page.getByLabel('Mentions');
    await mentions.selectOption({ index: 1 });
    await expect(page).toHaveURL(/entity=/);
    await expect(page.locator('#journal-summary')).toContainText(/1 reading|2 readings/);
  });

  test('no consent: nothing is sent, the panel says so plainly', async ({ page }) => {
    const user = await createReadyUser('memory-off', { aiConsent: false, extraction: true });
    await signInViaUi(page, user.email);
    await saveReading(page, 'Should I move to Leeds?', 'My mum thinks not.');
    await runJobs();
    const panel = page.getByRole('main').getByText('Not sorted.');
    await expect(panel).toBeVisible();
    const { count } = await admin()
      .from('ai_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);
    const { count: entities } = await admin()
      .from('entities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(entities).toBe(0);
  });
});
