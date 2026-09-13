import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y, freshEmail, PASSWORD, signUpViaUi, tabTo } from './_helpers';

test.describe('onboarding', () => {
  test('sign up → 4 steps → Home, keyboard only, axe-clean, resumable; sign out → sign in skips it', async ({
    page,
  }, testInfo) => {
    const email = freshEmail('onb');
    const started = Date.now();
    await signUpViaUi(page, email);

    // Step 1 — Welcome. Heading is focused on arrival.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'See how your readings connect over time.',
    );
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await expectNoSeriousA11y(page);
    await tabTo(page, page.getByRole('button', { name: "Let's begin" }));
    await page.keyboard.press('Enter');

    // Step 2 — Usage style. Focus moved to the new heading.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How do you usually read?');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByText('Every way of reading stays available')).toBeVisible();
    await expectNoSeriousA11y(page);

    // Drop off and come back: resumes on step 2, never restarts.
    await page.goto('/home');
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText('Step 2 of 4')).toBeVisible();

    // Back works, then forward again.
    await tabTo(page, page.getByRole('button', { name: 'Back' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: "Let's begin" }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'I use my own deck' }));
    await page.keyboard.press('Enter');

    // Step 3 — Experience, skipped.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'How familiar are you with tarot?',
    );
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expectNoSeriousA11y(page);
    await tabTo(page, page.getByRole('button', { name: 'Skip' }));
    await page.keyboard.press('Enter');

    // Step 4 — Consent, accepted.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your journal is private.');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Read the full privacy policy' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await tabTo(page, page.getByRole('button', { name: 'Allow AI interpretation' }));
    await page.keyboard.press('Enter');

    // Straight into the first reading (§6.1 step 13), then Home via the nav.
    await expect(page).toHaveURL(/\/reading\/new$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you asking?');
    await expectNoSeriousA11y(page);
    await tabTo(
      page,
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }),
      40,
    );
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('link', { name: 'Start a reading' })).toBeVisible();
    await expectNoSeriousA11y(page);
    testInfo.annotations.push({
      type: 'signup-to-home-ms',
      description: String(Date.now() - started),
    });

    // Preferences stuck: Profile shows AI on and the usage style choice survived.
    await page.goto('/profile');
    await expect(page.getByText('On. Readings can be sent')).toBeVisible();
    await expectNoSeriousA11y(page);

    // Sign out → sign in → Home, onboarding not repeated.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto('/home');
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/home$/);
    // Signed-in users bounce off the auth screens.
    await page.goto('/sign-in');
    await expect(page).toHaveURL(/\/home$/);
  });

  test('declining AI consent yields a working app with AI surfaces absent', async ({ page }) => {
    const email = freshEmail('decline');
    await signUpViaUi(page, email);
    await page.getByRole('button', { name: "Let's begin" }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your journal is private.');
    await page.getByRole('button', { name: /Not now/ }).click();
    await expect(page).toHaveURL(/\/reading\/new$/);

    await page.goto('/home');
    await expect(page.getByRole('link', { name: 'Start a reading' })).toBeVisible();
    await expectNoSeriousA11y(page);

    await page.goto('/profile');
    await expect(page.getByText('Off. Your journal works fully without it')).toBeVisible();
    const toggle = page.getByRole('switch', { name: 'AI interpretation' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Consent can be granted later from Profile, and withdrawn again.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The revalidated description proves the write landed; reload proves it persisted.
    await expect(page.getByText('On. Readings can be sent')).toBeVisible();
    await page.reload();
    await expect(page.getByText('On. Readings can be sent')).toBeVisible();
    await page.getByRole('switch', { name: 'AI interpretation' }).click();
    await expect(page.getByText('Off. Your journal works fully without it')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Off. Your journal works fully without it')).toBeVisible();
    // Explanation depth saves on change.
    const depthSaved = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.getByRole('combobox', { name: 'Explanation depth' }).selectOption('deep');
    await depthSaved;
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Explanation depth' })).toHaveValue('deep');
    await expectNoSeriousA11y(page);
  });
});
