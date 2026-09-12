import { expect, test } from '@playwright/test';
import { freshEmail, latestEmailLink, PASSWORD, signUpViaUi } from './_helpers';

/** Real email links through the local Mailpit inbox (Supabase local_smtp). */
test.describe('email links', () => {
  test('password reset: request → email → new password → sign in with it', async ({ page }) => {
    const email = freshEmail('reset');
    await signUpViaUi(page, email);
    await page.getByRole('button', { name: "Let's begin" }).click();
    await page.goto('/profile'); // bounces to onboarding; sign out via the sign-in bounce instead
    await page.context().clearCookies();

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('a link is on its way');

    const link = await latestEmailLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/);
    const newPassword = 'a-brand-new-password-9';
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Repeat new password').fill(newPassword);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/(home|onboarding)$/);

    await page.context().clearCookies();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("don't match");
    // The typed email survives a failed attempt (forms reset after an action otherwise).
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await page.getByLabel('Password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/(home|onboarding)$/);
  });

  test('magic link signs a new user in and drops them into onboarding', async ({ page }) => {
    const email = freshEmail('magic');
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByRole('status')).toContainText('a link is on its way');

    const link = await latestEmailLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
  });

  test('a used or expired link lands on sign-in with a neutral hint', async ({ page }) => {
    await page.goto('/auth/callback?code=not-a-real-code&next=/home');
    await expect(page).toHaveURL(/\/sign-in\?link=expired$/);
    await expect(page.getByRole('status')).toContainText('expired or was already used');
  });
});
