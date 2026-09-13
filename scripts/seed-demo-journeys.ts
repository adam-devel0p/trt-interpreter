import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import { journeys, profiles, readings } from '../src/db/schema';
import { materializeJourneysForReading } from '../src/journeys/materialize';
import { runProposeJourney } from '../src/journeys/propose';
import { refreshJourney } from '../src/journeys/refresh';
import type { SeedContext } from './seed-demo';

/**
 * Phase 07 — journeys for the consenting demo user, derived by the real pipeline from the
 * entities and themes `seedMemory` produced: every live reading is walked in date order
 * through assignment + discovery (the same step the extraction job runs), each new journey
 * is named by `propose_journey` (mock provider), and one is renamed the way a person would
 * — so the title pin, a mixed-deck relationship arc, an RWS-only career arc with open loops
 * and a weak suggested journey all exist on a fresh database. Wipes and rebuilds, like the
 * seeders before it (the readings are regenerated on every run).
 */
export async function seedJourneys(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedJourneys needs the users seeder first');
  await db.delete(journeys).where(inArray(journeys.userId, userIds));

  const users = await db
    .select({ id: profiles.id, consent: profiles.aiConsentAt })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  let created = 0;
  let named = 0;
  for (const u of users) {
    if (!u.consent) continue;
    await platformSql()`
      insert into public.user_flags (user_id, flag, enabled, set_by)
      values (${u.id}, 'journey_autocreate', true, 'rollout')
      on conflict (user_id, flag) do update set enabled = true`;
    const rows = await db
      .select({ id: readings.id })
      .from(readings)
      .where(and(eq(readings.userId, u.id), isNull(readings.deletedAt)))
      .orderBy(asc(readings.occurredAt));
    for (const r of rows) {
      const out = await materializeJourneysForReading(r.id);
      created += out.created;
    }
    const mine = await db
      .select({ id: journeys.id, title: journeys.title, status: journeys.status })
      .from(journeys)
      .where(eq(journeys.userId, u.id));
    for (const j of mine) {
      const out = await runProposeJourney(j.id);
      if (out.status === 'named') named += 1;
      await refreshJourney(j.id);
    }
    await applyDemoActions(u.id);
  }
  console.log(
    `  ${created} journeys gathered, ${named} named by the mock, one renamed by the user`,
  );
}

/** What a person would do after a month: give the relationship thread their own name. */
async function applyDemoActions(userId: string): Promise<void> {
  const db = platformDb();
  const active = await db
    .select({ id: journeys.id, title: journeys.title })
    .from(journeys)
    .where(and(eq(journeys.userId, userId), eq(journeys.status, 'active')))
    .orderBy(asc(journeys.startedAt));
  const relationship = active.find((j) => /maya/i.test(j.title)) ?? active[0];
  if (!relationship) return;
  await db
    .update(journeys)
    .set({
      title: 'Me and Maya',
      titleSource: 'user',
      userConfirmed: true,
      acceptedAt: new Date(),
    })
    .where(eq(journeys.id, relationship.id));
}
