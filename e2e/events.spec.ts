import { expect, test } from '@playwright/test';
import {
  createReadyUser,
  enqueueExtractions,
  expectNoSeriousA11y,
  runJobs,
  seedReadings,
  signInViaUi,
  tabTo,
} from './_helpers';

/**
 * Phase 08 at 390px — the reading-to-reality loop: a history about the agency is extracted
 * and gathers into a journey; Home shows the overdue revisit; "Something happened" is one
 * tap away; log "I accepted the new job at the agency today." in one sentence → the cron
 * extracts, scores and explains → at most three proposals with their actual reasons →
 * Confirm one, mark one Unrelated (undoable) → the journey's sections show both → record an
 * outcome for the due revisit from the reading → the revisit clears from Home. Every control
 * is keyboard-reachable; inferred status is a word; axe finds nothing serious.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

async function drainJobs(max = 8) {
  for (let i = 0; i < max; i++) {
    const { claimed } = await runJobs();
    if (claimed === 0 && i > 0) break;
  }
}

test.describe('life events, connections, outcomes', () => {
  test('log an event → review ≤3 proposals → confirm / reject → journey reflects it → outcome clears the revisit', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = await createReadyUser('events', {
      aiConsent: true,
      extraction: true,
      journeys: true,
      correlation: true,
    });
    const ids = await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['strength', 'the-tower', 'ace-of-cups'],
        question: 'Should I apply for the design lead role at the agency?',
        notes: 'The agency wants a decision. Stop waiting to be asked.',
        occurredAt: daysAgo(45),
      },
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['the-star', 'eight-of-cups', 'the-hermit'],
        question: 'Take the offer or stay at the agency?',
        notes: 'The agency offer opens more. Decide by next month.',
        occurredAt: daysAgo(30),
        // The user asked to come back to this a week ago: due on Home.
        revisitAt: daysAgo(7),
      },
      {
        deck: 'thoth',
        spread: 'three-card',
        cards: ['lust', 'the-universe', 'princess-of-disks'],
        question: 'What should I focus on before the review at the agency?',
        notes: 'The agency review. Focus on the work, not the worry.',
        occurredAt: daysAgo(12),
      },
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['temperance'],
        question: 'What does the autumn hold for my health?',
        notes: 'Slow down; find a routine.',
        occurredAt: daysAgo(20),
      },
    ]);
    await enqueueExtractions(user.id, ids);
    await drainJobs();

    await signInViaUi(page, user.email);

    // Home: the overdue revisit is content-anchored and calm, and the one-tap entry is there.
    const due = page.getByTestId('due-revisits');
    await expect(due).toContainText('Take the offer or stay at the agency?');
    await expect(due).toContainText('what happened?');
    await expectNoSeriousA11y(page);
    await page.getByRole('link', { name: 'Something happened' }).first().click();
    await expect(page).toHaveURL(/\/event\/new$/);
    await expectNoSeriousA11y(page);

    // One sentence, the date defaults to today; no tarot framing anywhere on the form.
    const sentence = page.getByLabel('What happened?');
    await expect(sentence).toBeFocused();
    await sentence.fill('I accepted the new job at the agency today.');
    await expect(page.getByLabel('When')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByText(/card|spread|deck/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/event\/[0-9a-f-]+\?saved=1/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'I accepted the new job at the agency today.',
    );
    // Saved before any AI: the screen is complete and says it is looking, not that it found.
    await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
    const eventUrl = page.url().replace(/\?.*$/, '');

    // The cron: extraction → correlation → explanations.
    await drainJobs();
    await page.goto(eventUrl);
    const review = page.getByTestId('connection-review').first();
    await expect(review).toBeVisible();
    const proposals = review.locator('[data-link-state="pending"]');
    const count = await proposals.count();
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
    // Each proposal: the reading, its date, its cards, the band in words, the actual reasons.
    const first = proposals.first();
    await expect(first).toContainText(/(Likely|Possible) connection/);
    await expect(first).toContainText('inferred');
    await expect(first).toContainText('the agency');
    await expect(first.getByRole('list', { name: 'Reasons' })).toContainText(
      'Both mention the agency',
    );
    await expect(first.getByLabel(/Cards from/)).toBeVisible();
    // "Why am I seeing this?" opens the full breakdown.
    await first.getByText('Why am I seeing this?').click();
    await expect(first).toContainText('Same people, places or things');
    await expect(first).toContainText('Close in time');
    // The Thoth reading, if offered, shows its own card names.
    const thoth = proposals.filter({ hasText: 'Thoth' });
    if (await thoth.count()) {
      await expect(thoth.first()).toContainText('Lust');
      await expect(thoth.first()).not.toContainText('Strength');
    }
    await expectNoSeriousA11y(page);

    // Keyboard: Tab reaches Confirm; the group has an accessible name naming the reading.
    const confirm = first.getByRole('button', { name: 'Confirm' });
    await tabTo(page, confirm, 60);
    await expect(first.getByRole('group', { name: /Decide:/ })).toBeVisible();
    const firstTitle = (await first.getByRole('link').first().textContent())!.trim();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.locator('[data-link-state="confirmed"]')).toContainText(firstTitle);
    // Undo, then confirm again — one tap each way.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-link-state="confirmed"]')).toHaveCount(0);
    await page
      .locator('[data-link-state="pending"]')
      .filter({ hasText: firstTitle })
      .getByRole('button', { name: 'Confirm' })
      .click();
    await expect(page.locator('[data-link-state="confirmed"]')).toContainText(firstTitle);

    // Mark another unrelated: it moves to Decided as "Unrelated — you said so".
    const second = page.locator('[data-link-state="pending"]').first();
    const secondTitle = (await second.getByRole('link').first().textContent())!.trim();
    await second.getByRole('button', { name: 'Unrelated' }).click();
    await expect(page.locator('[data-link-state="rejected"]')).toContainText(secondTitle);
    await expect(page.locator('[data-link-state="rejected"]')).toContainText(
      'Unrelated — you said so',
    );

    // The journey (gathered from the three agency readings) shows both decisions.
    await page.goto('/journey');
    await page
      .getByRole('link', { name: /agency/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]+$/);
    const outcomes = page.locator('[data-section="outcomes"]');
    await expect(outcomes).toContainText('Connections you confirmed');
    await expect(outcomes).toContainText('I accepted the new job at the agency today.');
    const connections = page.locator('[data-section="connections"]');
    await expect(connections).not.toContainText('Unrelated — you said so');
    // The event sits in the timeline as a fact, labelled as such.
    await expect(page.getByTestId('journey-timeline')).toContainText('life event');
    await expectNoSeriousA11y(page);

    // Record what happened for the due revisit: "It happened", with the event it was.
    await page.goto(`/reading/${ids[1]}`);
    const panel = page.getByTestId('outcome-panel');
    await panel.getByRole('button', { name: 'It happened' }).click();
    await panel.getByLabel('Pick an existing one').check();
    await panel.getByLabel('Existing life event').selectOption({ index: 1 });
    await panel.getByRole('button', { name: 'Record' }).click();
    await expect(panel).toContainText('What happened · you');
    await expect(panel).toContainText('It happened');
    await expect(panel).toContainText('I accepted the new job at the agency today.');
    await expect(
      page.getByRole('group', { name: 'Follow-up status' }).getByRole('button', { pressed: true }),
    ).toHaveText('Resolved');
    await expectNoSeriousA11y(page);

    // Home: the revisit has cleared.
    await page.goto('/home');
    await expect(page.getByTestId('due-revisits')).toHaveCount(0);
  });

  test('an event that relates to nothing is a normal, complete object; photo control is labelled', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('events-quiet', {
      aiConsent: true,
      extraction: true,
      correlation: true,
    });
    await signInViaUi(page, user.email);
    await page.goto('/journal');
    await page.getByRole('link', { name: 'Something happened' }).click();
    await page.getByLabel('What happened?').fill('Went for a long walk to clear my head.');
    await page.getByLabel('When').fill('2026-09-01');
    await page.getByRole('button', { name: 'Add a note or a photo' }).click();
    await expect(page.getByLabel(/^Photo/)).toBeVisible();
    await page.getByLabel(/^Photo/).setInputFiles({
      name: 'walk.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByLabel('Describe the photo')).toBeVisible();
    await page.getByLabel('Describe the photo').fill('A path through the park');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/event\/[0-9a-f-]+\?saved=1$/);
    await expect(page.getByRole('img', { name: 'A path through the park' })).toBeVisible();
    await drainJobs();
    await page.reload();
    await expect(page.getByText('No connection found. That is a normal result')).toBeVisible();
    await expectNoSeriousA11y(page);
    // It is listed, dated and unconnected — and deletable, naming what goes.
    await page.getByRole('link', { name: 'All events' }).click();
    await expect(page.getByRole('link', { name: /Went for a long walk/ })).toContainText(
      'Not connected to a reading',
    );
  });
});
