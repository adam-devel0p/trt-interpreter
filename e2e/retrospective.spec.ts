import { expect, test } from '@playwright/test';
import {
  createReadyUser,
  expectNoSeriousA11y,
  seedReadings,
  signInAsDemo,
  signInViaUi,
} from './_helpers';

/**
 * Phase 10 at 390px — summaries and retrospectives (FR-20, §6.5, §15.2, §4.7). On the demo
 * journal: a journey opens with its stored narrative header and "summary so far"; the
 * monthly retrospective is navigable by heading, shows the generated summary with every
 * claim's basis, and taps through to a cited entry; recurring symbols carry a text
 * equivalent for their one visual; none of it makes a model call. On a fresh user: an old
 * reading resurfaces on Home (exactly thirty days ago), is switched off and back on in
 * Profile, and stays gone once dismissed. Nowhere a streak, a badge or a "draw again".
 */

const DAY = 86_400_000;

async function aiCalls(userId: string): Promise<number> {
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

async function demoUserId(): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const session = await anon.auth.signInWithPassword({
    email: 'demo-ana@tarot.local',
    password: 'demo-password-123',
  });
  const id = session.data.user?.id;
  if (!id) throw new Error('demo-ana@tarot.local not found — run pnpm demo:seed');
  return id;
}

test.describe('summaries and retrospectives', () => {
  test('demo: journey narrative → monthly retrospective → sources, with zero model calls', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const userId = await demoUserId();
    const before = await aiCalls(userId);
    await signInAsDemo(page, 'demo-ana@tarot.local');

    // The journey with the most entries carries a stored narrative header and a summary.
    await page.goto('/journey');
    await page
      .getByRole('link', { name: /agency/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/journey\//);
    const narrative = page.getByTestId('journey-narrative');
    await expect(narrative).toBeVisible();
    await expect(narrative).toContainText(/Your readings about/);
    await expect(narrative).toContainText(/Rests on/);
    await expect(narrative.getByRole('link').first()).toHaveAttribute(
      'href',
      /\/(reading|event)\//,
    );
    const journeySummary = page.locator('section[data-section="summary"]');
    await expect(journeySummary.getByTestId('summary-view')).toBeVisible();
    await expect(journeySummary).toContainText(
      /Confirmed by you|From the cards|Noticed by the app|Your reflection/,
    );
    // Recurring symbols: the one visual has a text equivalent; a pattern says so, two does not.
    const symbols = page.getByTestId('recurring-symbols');
    await expect(symbols).toBeVisible();
    const first = symbols.locator('li').first();
    await first.locator('summary').click();
    await expect(first.getByTestId('symbol-timeline').locator('figcaption')).toContainText(
      /: .+\./,
    );
    await expect(first.locator('svg')).toHaveAttribute('role', 'img');
    const pattern = symbols.locator('li[data-pattern="true"]').first();
    if (await pattern.count()) await expect(pattern.locator('summary')).toContainText(/pattern/);
    const twice = symbols.locator('li[data-pattern="false"]').first();
    if (await twice.count()) await expect(twice.locator('summary')).not.toContainText(/pattern/);
    await expectNoSeriousA11y(page);

    // The retrospective index lists complete months; last month opens.
    await page.goto('/retrospective');
    await expectNoSeriousA11y(page);
    const months = page.getByTestId('retro-months');
    await expect(months.getByRole('link').first()).toBeVisible();
    await months.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/retrospective\/\d{4}-\d{2}$/);
    // Navigable by heading, in order; the generated summary with bases and source links.
    const headings = page.locator('main h2, article h2');
    await expect(headings.filter({ hasText: 'In a few sentences' })).toBeVisible();
    await expect(headings.filter({ hasText: 'What kept coming back' })).toBeVisible();
    await expect(headings.filter({ hasText: 'What happened' })).toBeVisible();
    await expect(headings.filter({ hasText: 'Outcomes you recorded' })).toBeVisible();
    await expect(headings.filter({ hasText: 'Journeys that moved' })).toBeVisible();
    await expect(headings.filter({ hasText: 'Still open' })).toBeVisible();
    const summary = page.getByTestId('summary-view');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/Confirmed by you/);
    await expect(page.getByTestId('summary-controls')).toContainText('Dismiss this summary');
    await expect(page.getByTestId('summary-controls')).toContainText('one model call');
    // No streaks, badges or draw-again nudges anywhere on the retrospective.
    await expect(page.locator('body')).not.toContainText(/streak|badge|draw again|pull again/i);
    await expectNoSeriousA11y(page);
    // Tap through to a source the summary cites.
    const cite = summary
      .getByRole('list', { name: 'Entries this rests on' })
      .first()
      .getByRole('link')
      .first();
    await cite.click();
    await expect(page).toHaveURL(/\/(reading|event)\//);

    // Opening all of it made no model call.
    expect(await aiCalls(userId)).toBe(before);
  });

  test('fresh user: an old reading resurfaces on Home once a day, switches off in Profile, stays dismissed', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createReadyUser('retro', { aiConsent: false });
    await seedReadings(user.id, [
      {
        deck: 'rws-classic',
        spread: 'one-card',
        cards: ['the-star'],
        question: 'Thirty days ago: what do I carry?',
        occurredAt: new Date(Date.now() - 30 * DAY).toISOString(),
      },
      {
        deck: 'thoth',
        spread: 'one-card',
        cards: ['lust'],
        question: 'A week ago, nothing to resurface.',
        occurredAt: new Date(Date.now() - 7 * DAY).toISOString(),
      },
    ]);
    await signInViaUi(page, user.email);
    const card = page.getByTestId('insight');
    await expect(card).toHaveAttribute('data-kind', 'on_this_day');
    await expect(card).toContainText('30 days ago');
    await expect(card).toContainText('Thirty days ago: what do I carry?');
    await expect(card).not.toContainText(/streak|draw again/i);
    await expectNoSeriousA11y(page);

    // Switch it off in Profile: Home shows nothing; on again: the same card is back.
    await page.goto('/profile');
    const toggle = page.getByTestId('retention-on_this_day');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expectNoSeriousA11y(page);
    await page.goto('/home');
    await expect(page.getByTestId('insight')).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby="insight-heading"]')).toContainText(
      'No insight yet',
    );
    await page.goto('/profile');
    await page.getByTestId('retention-on_this_day').click();
    await expect(page.getByTestId('retention-on_this_day')).toHaveAttribute('aria-checked', 'true');
    await page.goto('/home');
    await expect(page.getByTestId('insight')).toHaveAttribute('data-kind', 'on_this_day');

    // Dismiss: gone now, and still gone after a reload.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('insight')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('insight')).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby="insight-heading"]')).toContainText(
      'No insight yet',
    );
  });
});
