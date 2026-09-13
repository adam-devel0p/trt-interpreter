import { expect, test, type Page } from '@playwright/test';
import { createReadyUser, expectNoSeriousA11y, signInViaUi, tabTo } from './_helpers';

/**
 * Phase 03: the reading loop with zero AI. Digital and physical readings save and reopen,
 * Thoth never offers reversals, open reflection needs no question and no life area, a refresh
 * mid-flow loses nothing, a physical three-card reading logs in well under a minute, the whole
 * physical flow works keyboard-only, and every screen is axe-clean at 390px.
 */

const UUID = /\/reading\/[0-9a-f-]{36}/;

async function signIn(page: Page, tag: string) {
  const user = await createReadyUser(tag);
  await signInViaUi(page, user.email);
  return user;
}

async function startReading(page: Page, question: string | null) {
  await page.goto('/reading/new');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you asking?');
  if (question === null) {
    await page.getByRole('button', { name: 'Open reflection — no question' }).click();
  } else {
    await page.getByLabel('Your question').fill(question);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Is this about a part of life?');
}

/** Type a card name into the picker and press Enter. */
async function pickCard(page: Page, query: string) {
  const input = page.getByRole('combobox');
  await input.fill(query);
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await input.press('Enter');
}

test.describe('reading loop', () => {
  test('digital three-card RWS reading end to end, then revisit and follow-up', async ({
    page,
  }) => {
    await signIn(page, 'digital');
    await startReading(page, 'Should I take the job?');
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a spread');
    await page.getByRole('button', { name: /Past · Present · Future/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Which deck?');
    const rws = page
      .getByRole('group', { name: 'Deck' })
      .getByRole('button', { name: /Rider–Waite–Smith/ });
    await expect(rws).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('list', { name: 'Cards in Rider–Waite–Smith' })).toContainText(
      'Strength',
    );
    // Switching deck changes accent and naming immediately, without leaving the step.
    await page.getByRole('group', { name: 'Deck' }).getByRole('button', { name: /Thoth/ }).click();
    await expect(page.locator('[data-deck="thoth"]').first()).toBeVisible();
    const thothList = page.getByRole('list', { name: 'Cards in Thoth' });
    await expect(thothList).toContainText('Lust');
    await expect(thothList).toContainText('Princess of Disks');
    await expect(thothList).not.toContainText(/Strength|Pentacles/);
    await rws.click();
    await expect(page.getByRole('list', { name: 'Cards in Rider–Waite–Smith' })).toContainText(
      'Page of Pentacles',
    );
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How are you drawing?');
    await page.getByRole('button', { name: /Draw digitally/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your cards');
    await expect(page.getByRole('main')).toContainText('no model chooses your cards');
    await page.getByRole('button', { name: 'Draw 3 cards' }).click();
    await page.getByRole('button', { name: 'Skip animation' }).click();
    const drawn = page.getByRole('list', { name: 'Drawn cards' }).getByRole('listitem');
    await expect(drawn).toHaveCount(3);
    await expect(drawn.nth(0)).toContainText('Past:');
    await expect(drawn.nth(2)).toContainText('Future:');
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What do you notice?');
    await page.getByLabel('What I notice').fill('A lot of swords for a job question.');
    await page.getByRole('button', { name: 'Save reading' }).click();

    await expect(page).toHaveURL(/\/reading\/[0-9a-f-]{36}\?saved=1$/);
    await expect(page.getByText('part of your timeline')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Should I take the job?');
    await expect(page.getByRole('main')).toContainText(
      'Past · Present · Future · Rider–Waite–Smith · digital draw',
    );
    await expect(
      page.getByRole('list', { name: 'Cards by position' }).getByRole('listitem'),
    ).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'AI interpretation' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Not generated.');
    await expect(page.getByLabel('In your own words')).toHaveValue(
      'A lot of swords for a job question.',
    );
    await expectNoSeriousA11y(page);

    // Future-facing → revisit chips offered once; picking one persists.
    const revisit = page.getByRole('group', { name: 'Revisit this?' });
    await expect(revisit).toBeVisible();
    await revisit.getByRole('button', { name: 'in 1 month' }).click();
    await expect(page.getByRole('list', { name: 'Details' })).toContainText('Revisit');
    await expect(revisit).toHaveCount(0);

    // Follow-up in one tap.
    const resolved = page
      .getByRole('group', { name: 'Follow-up status' })
      .getByRole('button', { name: 'Resolved', exact: true });
    await resolved.click();
    await expect(resolved).toHaveAttribute('aria-pressed', 'true');
    // The server-rendered chip updates after the action's refresh; only then is it persisted.
    const statusChip = page.getByRole('list', { name: 'Details' }).getByRole('listitem').first();
    await expect(statusChip).toHaveText('Resolved');
    await page.reload();
    await expect(statusChip).toHaveText('Resolved');

    // Notes autosave survives a reload.
    await page.getByLabel('In your own words').fill('Edited note, still mine.');
    await page.getByLabel('In your own words').blur();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('In your own words')).toHaveValue('Edited note, still mine.');

    // Per-card expansion shows the reference meaning for the position, no AI.
    const first = page.getByRole('main').locator('details').first();
    await first.locator('summary').click();
    await expect(first).toContainText(/suggests|may|one way/);
  });

  test('physical three-card RWS reading with two reversals; Thoth offers no reversal at all', async ({
    page,
  }) => {
    await signIn(page, 'physical');
    await startReading(page, 'What is the relationship asking of me?');
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /Situation · Advice · Outcome/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your cards');
    await expect(page.getByRole('combobox')).toBeFocused();
    await expect(page.getByLabel(/Card for position 1: Situation/)).toBeVisible();
    await pickCard(page, 'strength');
    await expect(page.getByLabel(/Card for position 2: Advice/)).toBeVisible();
    await pickCard(page, 'tower');
    await pickCard(page, 'ace of cups');
    const positions = page.getByRole('list', { name: 'Positions' }).getByRole('listitem');
    await expect(positions.nth(0)).toContainText('Strength');
    await expect(positions.nth(1)).toContainText('The Tower');
    await expect(positions.nth(2)).toContainText('Ace of Cups');
    await page.getByRole('button', { name: 'Reversed: Strength' }).click();
    await page.getByRole('button', { name: 'Reversed: The Tower' }).click();
    await expect(page.getByRole('button', { name: 'Reversed: Strength' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(positions.nth(0)).toContainText('reversed');
    // Orientation is announced in text on the card image too, not by rotation alone.
    await expect(
      page.getByRole('img', { name: 'Strength, reversed — Rider–Waite–Smith' }).first(),
    ).toBeVisible();
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();

    await expect(page).toHaveURL(UUID);
    const byPos = page.getByRole('list', { name: 'Cards by position' }).getByRole('listitem');
    await expect(byPos.nth(0)).toContainText('Situation: Strength · reversed');
    await expect(byPos.nth(1)).toContainText('Advice: The Tower · reversed');
    await expect(byPos.nth(2)).toContainText('Likely outcome: Ace of Cups');
    await expect(page.getByRole('main')).toContainText('physical deck');
    // Not future-facing by question, but the spread has an outcome position → offer revisit.
    await expect(page.getByRole('group', { name: 'Revisit this?' })).toBeVisible();
    await page.getByRole('button', { name: 'No thanks' }).click();
    await expect(page.getByRole('group', { name: 'Revisit this?' })).toHaveCount(0);

    // Thoth: pick the deck, physical entry, and there is no reversal control anywhere.
    await startReading(page, 'Same question, other deck');
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /^One card/ }).click();
    await page.getByRole('group', { name: 'Deck' }).getByRole('button', { name: /Thoth/ }).click();
    await expect(page.getByRole('main')).toContainText('no reversals');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    // The alias finds Lust but never renames it (Nine of Wands, titled "Strength", ranks first).
    await page.getByRole('combobox').fill('strength');
    await expect(page.getByRole('option', { name: /Lust/ })).toContainText('also “Strength”');
    await expect(page.getByRole('option', { name: /^Strength/ })).toHaveCount(0);
    await pickCard(page, 'lust');
    await expect(page.getByRole('list', { name: 'Positions' })).toContainText('Lust');
    await expect(page.getByRole('list', { name: 'Positions' })).not.toContainText('Strength');
    await expect(page.getByRole('button', { name: /^Reversed:/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    await expect(page.getByRole('main')).toContainText('One card · Thoth · physical deck');
    await expect(page.getByRole('list', { name: 'Cards by position' })).toContainText('Lust');
    const body = await page.getByRole('main').innerText();
    expect(body).not.toMatch(/Strength|Pentacles|Rider|Waite/);
    await expectNoSeriousA11y(page);
  });

  test('open reflection, one card, no question and no life area', async ({ page }) => {
    await signIn(page, 'open');
    await startReading(page, null);
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /^One card/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    await pickCard(page, 'the fool');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open reflection');
    await expect(page.getByRole('list', { name: 'Cards by position' })).toContainText('The Fool');
    await expect(page.getByRole('group', { name: 'Revisit this?' })).toHaveCount(0);
    await expectNoSeriousA11y(page);

    // Home shows it as still open.
    await page.goto('/home');
    await expect(page.getByRole('link', { name: /Open reflection/ })).toBeVisible();
  });

  test('a refresh mid-flow resumes with the cards entered, and so does a fresh tab (server draft)', async ({
    page,
    context,
  }) => {
    await signIn(page, 'resume');
    await startReading(page, 'Will the move go through?');
    await page.getByRole('button', { name: 'Work' }).click();
    await page.getByRole('button', { name: /Past · Present · Future/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    await pickCard(page, 'the star');
    await pickCard(page, 'the moon');
    // Let the debounced server draft land before reloading.
    await page.waitForTimeout(1600);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your cards');
    const positions = page.getByRole('list', { name: 'Positions' }).getByRole('listitem');
    await expect(positions.nth(0)).toContainText('The Star');
    await expect(positions.nth(1)).toContainText('The Moon');
    await expect(positions.nth(2)).toContainText('Choose a card');

    // A brand-new tab has no sessionStorage: the server draft restores the same state.
    const fresh = await context.newPage();
    await fresh.goto('/reading/new');
    await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('Your cards');
    await expect(
      fresh.getByRole('list', { name: 'Positions' }).getByRole('listitem').nth(1),
    ).toContainText('The Moon');
    await fresh.close();

    // Back never loses cards.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How are you drawing?');
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    await expect(positions.nth(0)).toContainText('The Star');
  });

  test('timed: a physical three-card reading logs in under a minute', async ({
    page,
  }, testInfo) => {
    await signIn(page, 'timed');
    await page.goto('/reading/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you asking?');
    const t0 = Date.now();
    let interactions = 0;
    const tap = async (fn: () => Promise<void>) => {
      interactions++;
      await fn();
    };
    await tap(() => page.getByLabel('Your question').fill('Three cards for the week'));
    await tap(() => page.getByLabel('Your question').press('Enter'));
    await tap(() => page.getByRole('button', { name: 'Skip' }).click());
    await tap(() => page.getByRole('button', { name: /Past · Present · Future/ }).click());
    await tap(() => page.getByRole('button', { name: 'Continue' }).click());
    await tap(() => page.getByRole('button', { name: /Enter my physical cards/ }).click());
    for (const q of ['3 cups', 'knight of swords', 'the sun']) {
      await tap(() => page.getByRole('combobox').fill(q));
      await tap(() => page.getByRole('combobox').press('Enter'));
    }
    await tap(() => page.getByRole('button', { name: 'Continue' }).click());
    await tap(() => page.getByRole('button', { name: 'Save reading' }).click());
    await expect(page).toHaveURL(UUID);
    const ms = Date.now() - t0;
    testInfo.annotations.push({ type: 'physical-3-card-ms', description: String(ms) });
    testInfo.annotations.push({
      type: 'physical-3-card-interactions',
      description: String(interactions),
    });
    expect(ms).toBeLessThan(60_000);
    expect(interactions).toBeLessThanOrEqual(14);
    await expect(page.getByRole('list', { name: 'Cards by position' })).toContainText(
      'Three of Cups',
    );
  });

  test('timed, human-paced: typing at 120ms per key with 700ms think time per tap stays under a minute', async ({
    page,
  }, testInfo) => {
    await signIn(page, 'paced');
    await page.goto('/reading/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you asking?');
    const think = () => page.waitForTimeout(700);
    const t0 = Date.now();
    await page.getByLabel('Your question').click();
    await page.keyboard.type('What should I pay attention to this week?', { delay: 120 });
    await think();
    await page.keyboard.press('Enter');
    await think();
    await page.getByRole('button', { name: 'Skip' }).click();
    await think();
    await page.getByRole('button', { name: /Past · Present · Future/ }).click();
    await think();
    await page.getByRole('button', { name: 'Continue' }).click();
    await think();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    await think();
    for (const q of ['six of pent', 'the hermit', 'page of cups']) {
      await page.keyboard.type(q, { delay: 120 });
      await think();
      await page.keyboard.press('Enter');
      await think();
    }
    await page.getByRole('button', { name: 'Reversed: The Hermit' }).click();
    await think();
    await page.getByRole('button', { name: 'Continue' }).click();
    await think();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    const ms = Date.now() - t0;
    testInfo.annotations.push({ type: 'physical-3-card-human-paced-ms', description: String(ms) });
    expect(ms).toBeLessThan(60_000);
    await expect(page.getByRole('list', { name: 'Cards by position' })).toContainText(
      'Present: The Hermit · reversed',
    );
  });

  test('keyboard-only: complete a physical reading without a pointer', async ({ page }) => {
    await signIn(page, 'keys');
    await page.goto('/reading/new');
    await tabTo(page, page.getByLabel('Your question'));
    await page.keyboard.type('Keyboard only');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Is this about a part of life?',
    );
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: 'Skip' }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: /Past · Present · Future/ }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'Continue' }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: /Enter my physical cards/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('the magician');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2 wands');
    await page.keyboard.press('Enter');
    await page.keyboard.type('queen of cups');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'Reversed: The Magician' }));
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Reversed: The Magician' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tabTo(page, page.getByRole('button', { name: 'Continue' }), 40);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What do you notice?');
    await tabTo(page, page.getByRole('button', { name: 'Save reading' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(UUID);
    const byPos = page.getByRole('list', { name: 'Cards by position' }).getByRole('listitem');
    await expect(byPos.nth(0)).toContainText('The Magician · reversed');
    await expect(byPos.nth(1)).toContainText('Two of Wands');
    await expect(byPos.nth(2)).toContainText('Queen of Cups');
  });

  test('reduced motion: the draw reveals instantly with no animation to skip', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, 'motion');
    await startReading(page, 'Instant?');
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /^One card/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Draw digitally/ }).click();
    await page.getByRole('button', { name: 'Draw a card' }).click();
    await expect(page.getByRole('list', { name: 'Drawn cards' }).getByRole('listitem')).toHaveCount(
      1,
    );
    await expect(page.getByRole('button', { name: 'Skip animation' })).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'One card layout' }).getByRole('img'),
    ).toBeVisible();
  });

  test('custom spread: create, use immediately, then edit and delete the reading', async ({
    page,
  }) => {
    await signIn(page, 'custom');
    await page.goto('/reading/spread/new');
    await page.getByLabel('Name', { exact: true }).fill('Week ahead');
    await page.getByLabel('Position 1 name').fill('Monday');
    await page.getByLabel('Position 2 name').fill('Midweek');
    await page.getByLabel('Position 3 name').fill('Weekend');
    await page.getByRole('button', { name: 'Add a position' }).click();
    await page.getByLabel('Position 4 name').fill('Thread');
    await expect(page.getByRole('group', { name: 'Week ahead layout' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Save spread' }).click();
    await expect(page).toHaveURL(/\/reading\/new$/);

    await startReading(page, 'What does the week hold?');
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('heading', { name: 'Your spreads' })).toBeVisible();
    await page.getByRole('button', { name: /Week ahead/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Enter my physical cards/ }).click();
    for (const q of ['the fool', 'the star', 'ten of cups', 'the world']) await pickCard(page, q);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page).toHaveURL(UUID);
    const byPos = page.getByRole('list', { name: 'Cards by position' }).getByRole('listitem');
    await expect(byPos).toHaveCount(4);
    await expect(byPos.nth(3)).toContainText('Thread: The World');
    await expect(page.getByRole('main')).toContainText('Week ahead · Rider–Waite–Smith');

    // Edit: change the question, reverse the first card, move the last card up.
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit reading');
    await page.getByLabel('Question', { exact: true }).fill('What does this week ask of me?');
    await page.getByRole('button', { name: 'Reversed: The Fool' }).click();
    await page.getByRole('button', { name: 'Move The World up' }).click();
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/reading\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'What does this week ask of me?',
    );
    await expect(byPos.nth(0)).toContainText('Monday: The Fool · reversed');
    await expect(byPos.nth(2)).toContainText('Weekend: The World');
    await expect(byPos.nth(3)).toContainText('Thread: Ten of Cups');

    // The spread is in use, so deleting it is refused with an honest message.
    await page.goto('/reading/spread/new');
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('status')).toContainText('used by one of your readings');

    // Delete the reading (confirmed) → Home; then the spread can go.
    await page.goBack();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete reading' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto('/reading/spread/new');
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'Your spreads' })).toHaveCount(0);
  });
});
