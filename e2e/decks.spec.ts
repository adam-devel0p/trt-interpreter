import { expect, test, type Page } from '@playwright/test';
import { createReadyUser, expectNoSeriousA11y, signInViaUi, tabTo } from './_helpers';

/**
 * Phase 02: deck reference layer. Both decks browsable in-app; Thoth detail shows zero RWS
 * terminology; public pages render for anon with metadata + JSON-LD; CardPicker is reachable
 * in ≤ 3 interactions, keyboard-only, and deck-scoped; Profile deck preferences persist.
 */

async function signIn(page: Page, tag: string) {
  const user = await createReadyUser(tag);
  await signInViaUi(page, user.email);
  return user;
}

test.describe('in-app deck browser', () => {
  test('browse both decks and open a card in each; Thoth detail has no RWS terms', async ({
    page,
  }) => {
    await signIn(page, 'decks');
    await page.goto('/decks');
    await expect(page.getByRole('heading', { level: 1, name: 'Decks' })).toBeVisible();
    const deckNav = page.getByRole('navigation', { name: 'Deck' });
    await expect(deckNav.getByRole('link')).toHaveCount(2);
    await expectNoSeriousA11y(page);

    // RWS grid → Strength (art card).
    await expect(page.getByRole('link', { name: /^Strength$/ })).toBeVisible();
    await page.getByRole('link', { name: /^Strength$/ }).click();
    await expect(page).toHaveURL(/\/decks\/rws-classic\/strength$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength');
    await expect(page.getByRole('img', { name: 'Strength — Rider–Waite–Smith' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reversed' })).toBeVisible();
    await expectNoSeriousA11y(page);

    // Thoth grid → Lust (typographic card). Zero RWS terminology on the page.
    await page.goto('/decks?deck=thoth');
    await expect(deckNav.getByRole('link', { name: 'Thoth' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const tiles = page.getByRole('main').getByRole('list').last().getByRole('listitem');
    await expect(tiles).toHaveCount(78);
    await expect(page.getByRole('main')).not.toContainText(
      /Pentacles|Page of|King of|\bJustice\b|Temperance/,
    );
    await expectNoSeriousA11y(page);

    await page.getByRole('link', { name: /^Lust$/ }).click();
    await expect(page).toHaveURL(/\/decks\/thoth\/lust$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lust');
    await expect(page.getByRole('img', { name: 'Lust — Thoth' })).toBeVisible();
    const main = page.getByRole('main');
    // The alias sentence names "Strength" only as a search term; everything else is Thoth-native.
    const body = (await main.innerText()).replace(/Found by searching:[^\n]*/g, '');
    expect(body).not.toMatch(/Strength|Pentacles|Rider|Waite/);
    await expect(main).toContainText(
      'read by elemental dignity and position rather than by reversal',
    );
    await expect(main).toContainText('Teth');
    await expectNoSeriousA11y(page);

    // Thoth court + suit are deck-native on the detail page too.
    await page.goto('/decks/thoth/princess-of-disks');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Princess of Disks');
    const court = (await page.getByRole('main').innerText()).replace(
      /Found by searching:[^\n]*/g,
      '',
    );
    expect(court).not.toMatch(/\bPage\b|Pentacles/);
  });

  test('in-deck search finds by alias and labels the real card', async ({ page }) => {
    await signIn(page, 'decksearch');
    await page.goto('/decks?deck=thoth');
    await page.getByRole('searchbox').fill('Strength');
    const grid = page.getByRole('main').getByRole('list').last();
    await expect(grid.getByRole('link', { name: /Lust/ })).toBeVisible();
    await expect(grid.getByRole('link', { name: /Lust/ })).toContainText('also “Strength”');
    await expect(grid.getByRole('link', { name: /^Strength/ })).toHaveCount(0);
    await page.getByRole('searchbox').fill('Two of Pentacles');
    await expect(grid.getByRole('link').first()).toContainText('Two of Disks');
  });
});

test.describe('public reference pages (anon)', () => {
  test('card page renders server-side with metadata, canonical and JSON-LD', async ({
    page,
    request,
  }) => {
    const res = await request.get('/cards/thoth/lust');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1');
    expect(html).toContain('Lust');
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/cards\/thoth\/lust"/);
    expect(html).toMatch(/<title>Lust — Thoth tarot card meaning/);

    await page.goto('/cards/thoth/lust');
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(ld!) as { '@type': string; headline: string; about: { name: string } };
    expect(data['@type']).toBe('Article');
    expect(data.headline).toBe('Lust — Thoth');
    expect(data.about.name).toBe('Lust');
    // One funnel line, one call to action, no sign-in wall.
    await expect(page.getByRole('link', { name: 'Start a journal' })).toHaveCount(1);
    await expectNoSeriousA11y(page);

    const rws = await request.get('/cards/rws-classic/strength');
    expect(rws.status()).toBe(200);
    expect(await rws.text()).toContain('/cards/rws/strength-640.webp');
  });

  test('deck and spread pages render for anon and are axe clean', async ({ page, request }) => {
    for (const path of [
      '/cards',
      '/cards/rws-classic',
      '/cards/thoth',
      '/spreads',
      '/spreads/celtic-cross-lite',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }
    await page.goto('/spreads/celtic-cross-lite');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Celtic cross, short');
    await expect(page.getByRole('group', { name: 'Celtic cross, short layout' })).toBeVisible();
    await expect(
      page.getByRole('list').filter({ hasText: 'The heart of the matter' }).first(),
    ).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect((JSON.parse(ld!) as { step: unknown[] }).step).toHaveLength(5);
    await expectNoSeriousA11y(page);

    await page.goto('/cards/thoth');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thoth');
    await expectNoSeriousA11y(page);
    const img = await request.get('/cards/rws/the-fool-320.avif');
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/avif');
  });
});

test.describe('CardPicker (/dev/ui)', () => {
  test('a card is picked in ≤ 3 interactions', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Picker: Thoth' }).click(); // per-reading setup, not per card
    const input = page.getByRole('combobox', { name: 'Find a card' });
    let interactions = 0;
    await input.click();
    interactions += 1;
    await input.pressSequentially('lust');
    interactions += 1;
    await input.press('Enter');
    interactions += 1;
    await expect(page.getByTestId('picked')).toContainText('Picked Lust · Thoth');
    expect(interactions).toBeLessThanOrEqual(3);
    test
      .info()
      .annotations.push({ type: 'interactions-per-card', description: String(interactions) });

    // Second card: a recent one is two interactions (focus + click).
    await page.getByRole('button', { name: 'Picker: Rider–Waite–Smith' }).click();
    const rwsInput = page.getByRole('combobox', { name: 'Find a card' });
    await rwsInput.click();
    await page.getByRole('option', { name: /The Star/ }).click();
    await expect(page.getByTestId('picked')).toContainText('Picked The Star · Rider–Waite–Smith');
  });

  test('keyboard-only selection, number search and deck scoping', async ({ page }) => {
    await page.goto('/dev/ui');
    const input = page.getByRole('combobox', { name: 'Find a card' });
    await tabTo(page, input, 60);
    await page.keyboard.type('3 cups');
    await expect(page.getByRole('option').first()).toContainText('Three of Cups');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picked')).toContainText('Picked Three of Cups');

    await page.keyboard.type('ace');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picked')).toContainText('Picked Ace of Cups');

    // Deck scoping: the Thoth picker never offers a Page of Pentacles.
    await page.getByRole('button', { name: 'Picker: Thoth' }).click();
    const thothInput = page.getByRole('combobox', { name: 'Find a card' });
    await thothInput.fill('Page of Pentacles');
    const options = page.getByRole('option');
    await expect(options.first()).toContainText('Princess of Disks');
    await expect(options.first()).toContainText('also “Page of Pentacles”');
    // Option *names* are deck-native; the alias appears only as "also …".
    const names = await options.locator('p.font-medium').allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).not.toMatch(/Page|Pentacles/);
    await thothInput.fill('Knight of Wands');
    await expect(options.first()).toContainText('Knight of Wands');

    // Filter chips are deck-native.
    await expect(
      page.getByRole('group', { name: 'Filter' }).first().getByRole('button', { name: 'Disks' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Filter' })
        .first()
        .getByRole('button', { name: 'Pentacles' }),
    ).toHaveCount(0);
    await expectNoSeriousA11y(page);
  });
});

test.describe('Profile deck preferences', () => {
  test('default deck and reversals persist', async ({ page }) => {
    await signIn(page, 'deckprefs');
    await page.goto('/profile');
    const select = page.getByRole('combobox', { name: 'Default deck' });
    await select.selectOption({ label: 'Thoth' });
    await expect(page.getByText('Thoth is offered first')).toBeVisible();
    const reversals = page.getByRole('switch', { name: 'Reversals' });
    await expect(reversals).toHaveAttribute('aria-checked', 'true');
    await reversals.click();
    await expect(reversals).toHaveAttribute('aria-checked', 'false');
    // The description is server-rendered after the write, so its change proves persistence.
    await expect(page.getByText('Off: every card is read upright.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Default deck' })).toHaveValue(/.+/);
    await expect(page.locator('select[name="deck"] option:checked')).toHaveText('Thoth');
    await expect(page.getByRole('switch', { name: 'Reversals' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('Thoth never uses reversals')).toBeVisible();
    // The default deck drives the in-app browser's default tab.
    await page.goto('/decks');
    await expect(
      page.getByRole('navigation', { name: 'Deck' }).getByRole('link', { name: 'Thoth' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousA11y(page);
  });
});
