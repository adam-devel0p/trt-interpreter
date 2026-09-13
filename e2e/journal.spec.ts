import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import {
  createReadyUser,
  expectNoSeriousA11y,
  seedReadings,
  signInAsDemo,
  signInViaUi,
  tabTo,
} from './_helpers';

/**
 * Phase 05: the journal at 390px — search by card name across decks (deck-native names),
 * filters that live in the URL, open → edit (deck change) → delete with a confirmation that
 * names what goes (and a receipt), export + download, keyboard-operable filters with a live
 * result count, a focus-trapped destructive confirm, and 60fps scrolling over 1000 entries.
 * Every path here is stored data: the `ai_calls` ledger does not move.
 */

/** The provider spy, scoped to one user (other specs run in parallel and do call the model). */
async function aiCallCount(userId: string): Promise<number> {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { count } = await admin
    .from('ai_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

const day = (n: number) => new Date(Date.UTC(2026, 5, 1 + n, 12)).toISOString();

async function seedJournal(userId: string) {
  return seedReadings(userId, [
    {
      deck: 'rws-classic',
      spread: 'three-card',
      cards: ['strength', 'the-tower', 'ace-of-cups'],
      question: 'Should I take the job in Lisbon?',
      notes: 'A lot of pentacles lately.',
      occurredAt: day(1),
    },
    {
      deck: 'thoth',
      spread: 'one-card',
      cards: ['lust'],
      question: 'What is this relationship asking of me?',
      occurredAt: day(20),
    },
    {
      deck: 'rws-classic',
      spread: 'one-card',
      cards: ['the-hermit'],
      question: null,
      notes: 'Quiet morning.',
      occurredAt: day(40),
    },
  ]);
}

test.describe('journal', () => {
  test('search by card name across decks, filters in the URL, clear in one tap — zero AI calls', async ({
    page,
  }) => {
    const user = await createReadyUser('journal-search', { aiConsent: true });
    await seedJournal(user.id);
    const calls = await aiCallCount(user.id);
    await signInViaUi(page, user.email);

    await page.goto('/journal');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Journal');
    const status = page.locator('#journal-summary');
    await expect(status).toContainText('3 readings.');
    await expect(page.getByRole('heading', { name: 'July 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'June 2026' })).toBeVisible();
    await expectNoSeriousA11y(page);

    // "strength" finds the RWS Strength and the Thoth Lust — shown under its own name.
    await page.getByRole('searchbox', { name: 'Search your readings' }).fill('strength');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/journal\?q=strength$/);
    await expect(status).toContainText('2 readings match.');
    const items = page
      .getByRole('list')
      .filter({ has: page.getByRole('link') })
      .getByRole('listitem');
    const thoth = page.locator('li[data-deck="thoth"]');
    await expect(thoth).toHaveCount(1);
    await expect(thoth).toContainText('Lust');
    await expect(thoth).not.toContainText(/Strength|Pentacles/);
    await expect(page.locator('li[data-deck="rws"]')).toContainText('Strength');
    await expectNoSeriousA11y(page);

    // Notes are searched too, with a typo.
    await page.getByRole('searchbox', { name: 'Search your readings' }).fill('pentacels');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=pentacels/);
    await expect(status).toContainText('1 reading match');
    await expect(page.locator('li[data-deck]')).toContainText('Lisbon');

    // Filters compose and land in the URL: deck + date.
    await page.getByRole('searchbox', { name: 'Search your readings' }).fill('');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Deck').selectOption({ label: 'Rider–Waite–Smith' });
    await expect(page).toHaveURL(/deck=rws-classic/);
    await expect(status).toContainText('2 readings match');
    await page.getByLabel('From').fill('2026-07-01');
    await expect(page).toHaveURL(/from=2026-07-01/);
    await expect(page).toHaveURL(/deck=rws-classic/);
    await expect(status).toContainText('1 reading match');
    await expect(page.locator('li[data-deck]')).toContainText('Open reflection');
    await expect(page.getByRole('button', { name: /Filters · on/ })).toBeVisible();
    await expectNoSeriousA11y(page);

    // Restorable: reload keeps the view; clear is one tap.
    await page.reload();
    await expect(status).toContainText('1 reading match');
    await page.getByRole('link', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(status).toContainText('3 readings.');
    expect(items).toBeDefined();
    expect(await aiCallCount(user.id)).toBe(calls);
  });

  test('open, edit (deck change marks the interpretation stale), delete with a named confirmation, receipt', async ({
    page,
  }) => {
    const user = await createReadyUser('journal-edit');
    const [, , hermit] = await seedJournal(user.id);
    await signInViaUi(page, user.email);
    await page.goto('/journal');
    await page.getByRole('link', { name: /Open reflection/ }).click();
    await expect(page).toHaveURL(new RegExp(`/reading/${hermit}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open reflection');

    // Edit: switch the deck to Thoth → cards cleared, honest notice, re-enter one card.
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit reading');
    await page.getByLabel('Deck').selectOption({ label: 'Thoth' });
    await expect(page.getByRole('status')).toContainText('cleared the cards');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    const input = page.getByRole('combobox', { name: /Card for position 1/ });
    await input.fill('universe');
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
    await input.press('Enter');
    await expectNoSeriousA11y(page);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/reading/${hermit}$`));
    await expect(page.getByRole('main')).toContainText('One card · Thoth');
    const byPos = page.getByRole('list', { name: 'Cards by position' });
    await expect(byPos).toContainText('The Universe');
    await expect(byPos).not.toContainText(/The World|Hermit/);
    // Notes survived the edit untouched (invariant 4).
    await expect(page.getByLabel('In your own words')).toHaveValue('Quiet morning.');

    // Delete: the confirmation names exactly what goes; focus is trapped in it.
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('This reading, its 1 card and your notes.');
    await expect(dialog).toContainText('cannot be undone');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]')),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete reading' }).click();
    await expect(page).toHaveURL(/\/home$/);

    await page.goto('/journal');
    await expect(page.locator('#journal-summary')).toContainText('2 readings.');
    await expect(page.getByRole('main')).not.toContainText('Open reflection');
    await page.goto(`/reading/${hermit}`);
    await expect(page.getByRole('heading', { name: "That page isn't here" })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Quiet morning');

    // The purge ran straight away: the receipt is on Profile.
    await page.goto('/profile');
    const receipts = page.getByRole('list', { name: 'Recent deletions' });
    await expect(receipts).toContainText('A reading');
    await expect(receipts).toContainText(/\d+ rows purged/);
  });

  test('export everything, download the archive, and read it back', async ({ page }) => {
    const user = await createReadyUser('journal-export', { aiConsent: true });
    const ids = await seedJournal(user.id);
    await signInViaUi(page, user.email);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const history = page.getByRole('list', { name: 'Export history' });
    await expect(history).toContainText('Ready', { timeout: 20_000 });
    await expect(history).toContainText(/\d+ KB/);
    await expectNoSeriousA11y(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      history.getByRole('link', { name: 'Download' }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const path = await download.path();
    const files = unzipSync(new Uint8Array(readFileSync(path!)));
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      schema_version: string;
      counts: Record<string, number>;
    };
    expect(manifest.schema_version).toBe('export/1.0.0');
    expect(manifest.counts['readings.json']).toBe(3);
    const readings = JSON.parse(strFromU8(files['readings.json']!)) as { id: string }[];
    expect(readings.map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(strFromU8(files['cards.json']!)).toContain('Lust');

    // A second request minutes later is declined politely; the archive stays available.
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('main')).toContainText(/few minutes ago|already being prepared/);
  });

  test('keyboard-only: filters, live result count, sort; the search results are announced', async ({
    page,
  }) => {
    const user = await createReadyUser('journal-keys');
    await seedJournal(user.id);
    await signInViaUi(page, user.email);
    await page.goto('/journal');
    const status = page.locator('#journal-summary');
    await expect(status).toHaveAttribute('aria-live', 'polite');

    await tabTo(page, page.getByRole('searchbox', { name: 'Search your readings' }));
    await page.keyboard.type('Lisbon');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('1 reading match');

    const filters = page.getByRole('button', { name: /^Filters/ });
    await tabTo(page, filters);
    await page.keyboard.press('Enter');
    await expect(filters).toHaveAttribute('aria-expanded', 'true');
    const deck = page.getByLabel('Deck');
    await tabTo(page, deck);
    await deck.selectOption('thoth');
    await expect(page).toHaveURL(/deck=thoth/);
    await expect(status).toContainText('No readings match.');
    await expect(page.getByRole('heading', { name: 'Nothing matches' })).toBeVisible();

    await page.getByLabel('Sort').selectOption('oldest');
    await expect(page).toHaveURL(/sort=oldest/);
    await page.getByLabel('Deck').selectOption('');
    await page.getByRole('searchbox', { name: 'Search your readings' }).fill('');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/journal\?sort=oldest$/);
    const first = page.locator('li[data-deck]').first();
    await expect(first).toContainText('Lisbon');
    await expectNoSeriousA11y(page);
  });

  test('scrolls a 1000-entry journal at 60fps (demo-cleo)', async ({ page }, testInfo) => {
    await signInAsDemo(page, 'demo-cleo@tarot.local');
    await page.goto('/journal');
    const status = page.locator('#journal-summary');
    await expect(status).toContainText(/30\+ readings/);
    const items = page.locator('li[data-deck]');
    await expect(items.first()).toHaveCSS('content-visibility', 'auto');

    // Pull every page in (the sentinel loads as it scrolls into view; the button is the fallback).
    for (let i = 0; i < 40; i++) {
      const more = page.getByRole('button', { name: /Load more|Loading/ });
      if ((await more.count()) === 0) break;
      const before = await items.count();
      await more.scrollIntoViewIfNeeded();
      await more.dispatchEvent('click');
      await expect.poll(() => items.count(), { timeout: 10_000 }).toBeGreaterThan(before);
    }
    await expect(status).toContainText('1000 readings.');
    expect(await items.count()).toBe(1000);

    // Scroll the whole list top → bottom → top, one step per animation frame, measuring frames.
    const stats = await page.evaluate(async () => {
      const frames: number[] = [];
      const step = 900;
      const total = document.documentElement.scrollHeight;
      let y = 0;
      let dir = 1;
      let last = performance.now();
      await new Promise<void>((done) => {
        const tick = (now: number) => {
          frames.push(now - last);
          last = now;
          y += step * dir;
          if (y >= total) dir = -1;
          if (y <= 0 && dir === -1) {
            done();
            return;
          }
          window.scrollTo(0, y);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const sorted = [...frames].sort((a, b) => a - b);
      const long = frames.filter((f) => f > 50).length;
      return {
        frames: frames.length,
        p50: sorted[Math.floor(sorted.length / 2)]!,
        p95: sorted[Math.floor(sorted.length * 0.95)]!,
        long,
        scrollHeight: total,
      };
    });
    testInfo.annotations.push({ type: 'scroll-1000-frames', description: JSON.stringify(stats) });
    expect(stats.frames).toBeGreaterThan(100);
    // 60fps = 16.7 ms per frame; allow the odd long frame while pages hydrate, never a jank run.
    expect(stats.p50).toBeLessThan(20);
    expect(stats.long / stats.frames).toBeLessThan(0.05);
  });
});
