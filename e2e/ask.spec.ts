import { expect, test } from '@playwright/test';
import {
  createReadyUser,
  enqueueEmbeddings,
  enqueueExtractions,
  expectNoSeriousA11y,
  runJobs,
  seedJourney,
  seedReadings,
  signInViaUi,
  tabTo,
} from './_helpers';

/**
 * Phase 09 at 390px — Ask My History (§6.6): a history about the agency and one about health
 * is extracted and embedded by the cron; on /ask the composer offers the §6.6 examples and
 * scope chips; a benchmark-shaped question streams its stages into a polite live region and
 * lands as a conclusion with claims and tappable, keyboard-reachable evidence cards; a
 * citation opens the right reading; an adversarial question gets the designed "not enough
 * evidence" state with what was found; inside a journey the answer cites journey evidence
 * only; reopening a stored ask makes no model call; axe finds nothing serious.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

async function drainJobs(max = 8) {
  for (let i = 0; i < max; i++) {
    const { claimed } = await runJobs();
    if (claimed === 0 && i > 0) break;
  }
}

test.describe('ask my history', () => {
  test('ask → cited answer → open a citation → adversarial honesty → journey-scoped ask', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = await createReadyUser('ask', { aiConsent: true, extraction: true, ask: true });
    const ids = await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['eight-of-cups', 'the-tower', 'ace-of-cups'],
        question: 'Should I apply for the design lead role at the agency?',
        notes: 'The agency wants a decision. Stop waiting to be asked.',
        occurredAt: daysAgo(60),
      },
      {
        deck: 'rws-classic',
        spread: 'three-card',
        cards: ['the-star', 'eight-of-cups', 'the-hermit'],
        question: 'Take the offer or stay at the agency?',
        notes: 'The agency offer opens more. Decide by next month.',
        occurredAt: daysAgo(30),
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
    await enqueueEmbeddings(
      user.id,
      ids.map((id) => ({ type: 'reading' as const, id })),
    );
    await drainJobs();
    const journeyId = await seedJourney(user.id, 'The agency', [ids[0]!, ids[1]!]);

    await signInViaUi(page, user.email);
    await page.goto('/ask');
    await expect(page.getByRole('heading', { level: 1, name: 'Ask my history' })).toBeVisible();
    // The §6.6 examples and the scope chips.
    await expect(
      page.getByRole('button', { name: 'Compare my readings about Bali and Thailand.' }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'All history' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'A journey' })).toBeEnabled();
    await expectNoSeriousA11y(page);

    // Benchmark #2, shaped to this history: cards that recur when asking about the agency.
    const question = page.getByLabel('Ask a question about your own history');
    await question.fill('What cards keep appearing when I ask about the agency?');
    const askButton = page.getByRole('button', { name: 'Ask', exact: true });
    await tabTo(page, askButton);
    await page.keyboard.press('Enter');
    // The stages land in a polite live region while the skeleton shows.
    const live = page.locator('[role="status"][aria-live="polite"]').first();
    await expect(live).toBeVisible();
    await expect(page.getByText('From your history')).toBeVisible({ timeout: 30_000 });
    const answer = page.locator('article[data-ask]').first();
    await expect(answer.getByRole('heading', { level: 2 })).toContainText(/Eight of Cups/);
    await expect(answer.getByText(/Eight of Cups appeared 2 times/).first()).toBeVisible();
    // Evidence cards are real links with descriptive names; never the health reading.
    const evidence = answer.getByRole('link', { name: /^E\d+: reading on/ });
    await expect(evidence.first()).toBeVisible();
    const count = await evidence.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) await expect(evidence.nth(i)).not.toContainText('health');
    // A Thoth reading is shown under its own deck's names.
    await expect(answer.getByText('Lust')).toHaveCount(0);
    await expectNoSeriousA11y(page);
    // Thumbs are one tap.
    await answer.getByRole('button', { name: 'Yes' }).click();
    await expect(answer.getByRole('button', { name: 'Yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Tap a citation → the right reading.
    const first = evidence.first();
    const href = await first.getAttribute('href');
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/agency/);

    // Reopening the stored ask: the same answer, no model call (the ai_calls ledger is the spy).
    await page.goto('/ask');
    const stored = page.getByRole('link', {
      name: /What cards keep appearing when I ask about the agency\?/,
    });
    await expect(stored).toBeVisible();
    const before = await countAiCalls(user.id);
    await stored.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'What cards keep appearing',
    );
    await expect(page.getByText(/Eight of Cups appeared 2 times/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    expect(await countAiCalls(user.id)).toBe(before);
    await expectNoSeriousA11y(page);

    // Adversarial: a person who never appears.
    await page.goto('/ask');
    await page
      .getByLabel('Ask a question about your own history')
      .fill('What did my readings say about Priya?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('Not enough evidence').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/none mention Priya/)).toBeVisible();
    await expect(page.getByText(/A narrower question/)).toBeVisible();
    await expect(
      page.locator('article[data-ask]').getByRole('link', { name: /^E\d+:/ }),
    ).toHaveCount(0);

    // Inside a journey: only its members can be cited.
    await page.goto(`/journey/${journeyId}`);
    await page.getByRole('link', { name: 'Ask about this journey' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /Ask about “The agency”/ }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'A journey' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'All history' })).toBeDisabled();
    await page
      .getByLabel('Ask a question about your own history')
      .fill('What cards keep appearing when I ask about the agency?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.locator('article[data-ask]')).toBeVisible({ timeout: 30_000 });
    const scoped = page.locator('article[data-ask] a[data-evidence]');
    const n = await scoped.count();
    expect(n).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < n; i++) {
      const id = await scoped.nth(i).getAttribute('data-evidence');
      expect([ids[0], ids[1]]).toContain(id);
    }
  });
});

async function countAiCalls(userId: string): Promise<number> {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { count } = await admin
    .from('ai_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}
