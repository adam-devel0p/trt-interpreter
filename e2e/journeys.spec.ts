import { expect, test } from '@playwright/test';
import {
  createReadyUser,
  enqueueExtractions,
  expectNoSeriousA11y,
  runJobs,
  seedReadings,
  signInViaUi,
} from './_helpers';

/**
 * Phase 07 at 390px: a history about one person (RWS and Thoth) is extracted by the cron
 * batch and gathers itself into a journey; a weaker pair becomes a single suggestion → open
 * the journey → scroll the timeline (month headings, every card under its own deck's name)
 * → tap a progression step to its sources → tap a recurring symbol to its readings → accept
 * the suggested journey → rename it (the title pins) → remove a member and undo. Nothing
 * required filing by hand; every control is keyboard-reachable; axe finds nothing serious.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

test.describe('journeys', () => {
  test('gather → open → timeline → progression → symbols → accept → rename → remove + undo', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const user = await createReadyUser('journeys', {
      aiConsent: true,
      extraction: true,
      journeys: true,
    });
    const ids = await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['strength', 'the-tower', 'ace-of-cups'],
        question: 'How is it going with Maya?',
        notes: 'We keep circling the same distance. A conversation we are not having.',
        occurredAt: daysAgo(40),
      },
      {
        deck: 'thoth',
        spread: 'three-card',
        cards: ['lust', 'the-universe', 'princess-of-disks'],
        question: 'What does Maya need from me?',
        notes: 'Maya wants a conversation, not a plan. The distance again.',
        occurredAt: daysAgo(25),
      },
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['strength', 'the-tower', 'two-of-cups'],
        question: 'Should I talk to Maya about the distance?',
        notes: 'Talk about the distance. Say it.',
        occurredAt: daysAgo(10),
      },
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['temperance'],
        question: 'What does the autumn hold for my health?',
        notes: 'Slow down; find a routine.',
        occurredAt: daysAgo(30),
      },
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['nine-of-pentacles'],
        question: 'Will the new routine stick?',
        notes: 'Quiet confidence. Health first.',
        occurredAt: daysAgo(5),
      },
    ]);
    // The cron: extraction (which assigns and gathers), then the naming job it queued. Other
    // specs share the queue, so drain it rather than assume one batch.
    await enqueueExtractions(user.id, ids);
    for (let i = 0; i < 6; i++) {
      const { claimed } = await runJobs();
      if (claimed === 0 && i > 0) break;
    }

    await signInViaUi(page, user.email);
    // Home shows the one suggestion, quietly.
    await expect(page.getByTestId('suggested-journey')).toBeVisible();
    await expect(page.getByTestId('suggested-journey')).toContainText('Possibly a journey');

    await page.goto('/journey');
    await expectNoSeriousA11y(page);
    const ongoing = page
      .getByRole('region', { name: 'Ongoing' })
      .or(page.locator('section[aria-labelledby="active-h"]'));
    await expect(ongoing).toContainText('Maya');
    await ongoing.getByRole('link', { name: /Maya/ }).first().click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]{36}$/);
    const journeyUrl = page.url();

    // Narrative header: real counts, both decks.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maya');
    await expect(page.locator('header')).toContainText(/3 readings and no confirmed outcomes yet/);
    await expect(page.locator('header')).toContainText('across both decks');

    // Timeline: a semantic list under month headings; Thoth cards keep Thoth names.
    const timeline = page.getByTestId('journey-timeline');
    await expect(timeline.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(timeline.locator('ol li')).toHaveCount(3);
    const thoth = timeline.locator('article[data-deck="thoth"]');
    await expect(thoth).toContainText('Lust');
    await expect(thoth).toContainText('Thoth');
    await expect(thoth).not.toContainText('Strength');
    await expect(timeline.locator('article[data-deck="rws"]').first()).toContainText('Strength');
    await timeline.locator('article').last().scrollIntoViewIfNeeded();

    // Progression: readable as text; a step opens to its sources.
    await expect(page.getByTestId('theme-progression')).toContainText(/The themes moved from/);
    const step = page.getByTestId('theme-progression').locator('details').first();
    await step.locator('summary').click();
    await expect(step.getByRole('link').first()).toHaveAttribute('href', /\/reading\//);

    // Recurring symbols: Strength under RWS, twice; Lust (once) is not there — and no mapping.
    const symbols = page.getByTestId('recurring-symbols');
    const strength = symbols.locator('li[data-symbol-kind="card"][data-deck="rws"]', {
      hasText: 'Strength',
    });
    await expect(strength).toContainText('Rider');
    await expect(symbols).not.toContainText('Lust');
    await strength.locator('summary').click();
    await expect(strength).toContainText(/Appeared in 2 of 3 readings/);
    await expect(strength.getByRole('link')).toHaveCount(2);
    await expectNoSeriousA11y(page);

    // The reading detail shows the membership as suggested, with why.
    await strength.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/reading\//);
    const panel = page.getByTestId('journey-panel');
    await expect(panel).toContainText('suggested');
    await expect(panel).toContainText('Maya');

    // Accept the suggested journey from the list; it moves to Ongoing.
    await page.goto('/journey');
    const card = page.getByTestId('suggested-journey');
    await expect(card).toContainText(/Stability and health|Health and stability/);
    await card.getByRole('button', { name: 'Keep it as a journey' }).click();
    await expect(page.getByTestId('suggested-journey')).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby="active-h"]')).toContainText(
      /Stability and health|Health and stability/,
    );

    // Rename pins the title; it survives a reload and the naming job.
    await page.goto(journeyUrl);
    const title = page.getByLabel('Title');
    await title.fill('Me and Maya');
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Me and Maya');
    await runJobs();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Me and Maya');
    await expect(page.getByText('Named by you. It stays as you wrote it.')).toBeVisible();

    // Remove a member (one tap), undo it. The reading itself is untouched.
    const first = page.getByTestId('journey-timeline').locator('article').first();
    await first.getByRole('button', { name: 'Remove from this journey' }).click();
    await expect(page.getByTestId('journey-timeline').locator('article')).toHaveCount(2);
    await expect(page.locator('header')).toContainText(/2 readings/);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('journey-timeline').locator('article')).toHaveCount(3);
    await expect(page.locator('header')).toContainText(/3 readings/);
    await page.goto('/journal');
    await expect(page.getByRole('link', { name: /Should I talk to Maya/ })).toBeVisible();
  });

  test('without the flag nothing gathers, and a journey can still be started by hand', async ({
    page,
  }) => {
    const user = await createReadyUser('journeys-off', { aiConsent: true, extraction: true });
    await signInViaUi(page, user.email);
    await page.goto('/journey');
    await expect(page.getByRole('heading', { name: 'No journeys yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Start a journey yourself' }).click();
    await page.getByLabel('What is it about?').fill('The house');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The house');
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
  });
});
