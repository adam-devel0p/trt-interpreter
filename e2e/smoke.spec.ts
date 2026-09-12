import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test('/ renders with primary nav and no serious axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A tarot journal that remembers',
  );
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expectNoSeriousA11y(page);
});

test('/api/health reports ok with DB and migration status', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    status: 'ok',
    db: true,
    migration: { current: true },
    provider: { configured: true },
  });
});

test('/home shows the 5-tab bottom nav, keyboard reachable', async ({ page }) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link')).toHaveCount(5);
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab'); // skip link
  await expect(page.getByText('Skip to content')).toBeFocused();
  await expectNoSeriousA11y(page);
});

test('/dev/ui renders every component in light and dark at this viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
  await expectNoSeriousA11y(page);

  // Dark via the system preference on a fresh document (axe caches computed styles per
  // injection, so auditing after an in-page toggle reads stale colours intermittently).
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
  await expectNoSeriousA11y(page);

  // Explicit toggles set the attributes the tokens key on.
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Thoth' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-deck', 'thoth');
  // Destructive confirmation is keyboard-operable and closes on Escape.
  await page.getByRole('button', { name: 'Delete this reading' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeHidden();
});

test('PWA manifest and service worker are served', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({ display: 'standalone', start_url: '/home' });
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  const offline = await request.get('/offline');
  expect(offline.ok()).toBeTruthy();
});

test('jobs endpoint rejects unauthenticated callers', async ({ request }) => {
  const res = await request.post('/api/jobs/run');
  expect(res.status()).toBe(401);
});
