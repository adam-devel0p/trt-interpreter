import { and, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import {
  jobs,
  journeyNarratives,
  journeys,
  periodSummaries,
  profiles,
  retentionPrompts,
} from '../src/db/schema';
import { generatePeriodSummary } from '../src/summaries/generate';
import { generateJourneyNarrative } from '../src/summaries/narrative';
import { duePeriods } from '../src/summaries/schedule';
import type { SeedContext } from './seed-demo';

/**
 * Phase 10 — summaries, narratives and a clean retention slate for the consenting demo
 * user, produced by the real generators (mock provider) exactly as the sweep would: every
 * complete month and week of the demo history above its data floor gets a summary, every
 * open journey a narrative header and a journey summary. Periods below the floor get
 * nothing, on purpose — the retrospective index shows them as too thin. Turns the
 * `period_summaries` flag on like a rollout. Retention prompts are cleared so Home starts
 * with nothing dismissed.
 */
export async function seedSummaries(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedSummaries needs the users seeder first');
  await db.delete(periodSummaries).where(inArray(periodSummaries.userId, userIds));
  await db.delete(journeyNarratives).where(inArray(journeyNarratives.userId, userIds));
  await db.delete(retentionPrompts).where(inArray(retentionPrompts.userId, userIds));
  // The journeys seeder's refreshes queued narrative jobs; the seed writes them directly.
  await db
    .delete(jobs)
    .where(
      and(
        inArray(jobs.userId, userIds),
        inArray(jobs.kind, ['journey_narrative', 'summarize_period']),
        eq(jobs.status, 'queued'),
      ),
    );

  const today = new Date().toISOString().slice(0, 10);
  let generated = 0;
  let floored = 0;
  let narratives = 0;
  for (const userId of userIds) {
    const [profile] = await db
      .select({ consent: profiles.aiConsentAt })
      .from(profiles)
      .where(eq(profiles.id, userId));
    if (!profile?.consent) continue;
    await platformSql()`
      insert into public.user_flags (user_id, flag, enabled, set_by)
      values (${userId}, 'period_summaries', true, 'rollout')
      on conflict (user_id, flag) do update set enabled = true`;
    const due = [
      ...(await duePeriods(userId, 'monthly', Math.max(ctx.months, 2) + 1, today)),
      ...(await duePeriods(userId, 'weekly', 8, today)),
    ];
    for (const p of due) {
      const out = await generatePeriodSummary({ userId, kind: p.kind, period: p });
      if (out.status === 'generated') generated += 1;
      else if (out.status === 'skipped' && out.reason === 'floor') floored += 1;
      else if (out.status === 'failed') throw new Error(`summary failed: ${out.errorClass}`);
    }
    const open = await db
      .select({ id: journeys.id })
      .from(journeys)
      .where(
        and(
          eq(journeys.userId, userId),
          inArray(journeys.status, ['active', 'dormant']),
          isNull(journeys.mergedIntoId),
        ),
      );
    for (const j of open) {
      const n = await generateJourneyNarrative(j.id);
      if (n.status === 'generated') narratives += 1;
      const s = await generatePeriodSummary({ userId, kind: 'journey', journeyId: j.id });
      if (s.status === 'generated') generated += 1;
    }
  }
  console.log(
    `  ${generated} summaries written, ${narratives} journey narratives, ${floored} periods left empty (below the floor)`,
  );
}
