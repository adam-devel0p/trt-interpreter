import { expect, test } from '@playwright/test';
import { AUTH_ROUTES, PROTECTED_PREFIXES } from '../src/auth/routes';
import { expectNoSeriousA11y, freshEmail } from './_helpers';

test.describe('route protection', () => {
  for (const path of PROTECTED_PREFIXES) {
    test(`unauthenticated ${path} redirects to sign-in`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()['location']).toMatch(/\/sign-in/);
    });
  }

  test('carries a return-to for nested paths', async ({ request }) => {
    const res = await request.get('/journal/abc?x=1', { maxRedirects: 0 });
    expect(res.headers()['location']).toContain(`next=${encodeURIComponent('/journal/abc?x=1')}`);
  });

  test('an expired or malformed session cookie redirects cleanly, never a 500', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'sb-127-auth-token',
        value:
          'base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0luUjVjQ0k2SWtwWFZDSjkuZXlKbGVIQWlPakV3TURBd01EQXdNREI5LmJhZCIsInJlZnJlc2hfdG9rZW4iOiJ4In0',
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
    const page = await context.newPage();
    const res = await page.goto('/home');
    expect(res?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });
});

test.describe('auth screens', () => {
  for (const path of [...AUTH_ROUTES, '/reset-password', '/privacy']) {
    test(`${path} renders and is axe-clean`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSeriousA11y(page);
    });
  }

  test('sign-in form errors are announced and never reveal whether an address exists', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(freshEmail('nobody'));
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toContainText("don't match");
    await expect(alert).not.toContainText(/no account|not found|does not exist/i);
    await expectNoSeriousA11y(page);
  });

  test('sign-up validation is announced with field-level messages', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('Google button is present and degrades to a neutral message without credentials', async ({
    page,
  }) => {
    // Never actually load Google: the proof is the redirect leaving for the provider.
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>provider stub</p>' }),
    );
    await page.goto('/sign-in');
    const btn = page.getByRole('button', { name: 'Continue with Google' });
    await expect(btn).toBeVisible();
    await btn.click();
    // Either we left for the provider (credentials configured) or were told it is unavailable.
    const alert = page.locator('p[role="alert"]');
    await expect
      .poll(async () => {
        if (/accounts\.google\.com|auth\/v1\/authorize/.test(page.url())) return 'provider';
        if ((await alert.count()) && (await alert.innerText()).includes("isn't available"))
          return 'unavailable';
        return 'pending';
      })
      .not.toBe('pending');
  });
});
