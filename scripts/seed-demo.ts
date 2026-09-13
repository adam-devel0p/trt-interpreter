import './_env';
import { parseArgs } from 'node:util';
import { authAdmin, closeAdmin, platformSql } from '../src/db/admin';
import { seedBulkReadings, seedReadings } from './seed-demo-readings';
import { seedInterpretations } from './seed-demo-interpretations';

/**
 * Demo journal generator (docs/IMPLEMENTATION_PLAN.md §3.10). Produces a coherent fictional
 * multi-month history so longitudinal UI can be tested on a fresh database.
 *
 * EXTENSION POINT: every phase that adds a longitudinal object registers a seeder below.
 * Seeders run in order and receive the shared context so later ones can reference earlier IDs.
 *
 *   Phase 01 → users + profiles          Phase 03 → readings + cards
 *   Phase 06 → extractions, entities     Phase 07 → journeys
 *   Phase 08 → life events, outcomes, links   Phase 10 → summaries
 */
export interface SeedContext {
  months: number;
  /** Deterministic RNG seed so demo data is reproducible across runs. */
  seed: number;
  /** Phase 05: generated readings for the bulk user (0 = none). */
  bulk: number;
  ids: Record<string, string[]>;
}

export interface Seeder {
  name: string;
  phase: string;
  run(ctx: SeedContext): Promise<void>;
}

/**
 * Phase 01 — two demo accounts. Idempotent: an existing address is reused. Password is the
 * same for both so the e2e suite and a developer can sign in: `demo-password-123`.
 *   demo-ana@tarot.local   consented to AI, digital reader, comfortable, onboarding done
 *   demo-ben@tarot.local   declined AI, physical deck, experienced, onboarding done
 *   demo-cleo@tarot.local  Phase 05: a generated 1000-reading journal (`--bulk`), for the
 *                          journal's performance and scroll checks; declined AI
 * Later seeders find their IDs in ctx.ids.users (same order).
 */
export const DEMO_USERS = [
  {
    email: 'demo-ana@tarot.local',
    usage_style: 'digital',
    experience_level: 'comfortable',
    ai_consent: true,
  },
  {
    email: 'demo-ben@tarot.local',
    usage_style: 'physical',
    experience_level: 'experienced',
    ai_consent: false,
  },
  {
    email: 'demo-cleo@tarot.local',
    usage_style: 'both',
    experience_level: 'comfortable',
    ai_consent: false,
  },
] as const;
export const BULK_USER_INDEX = 2;
export const DEMO_PASSWORD = 'demo-password-123';

async function seedUsers(ctx: SeedContext): Promise<void> {
  const admin = authAdmin();
  ctx.ids.users = [];
  for (const u of DEMO_USERS) {
    let id: string | undefined;
    const existing = await platformSql()<{ id: string }[]>`
      select id from auth.users where email = ${u.email} limit 1`;
    id = existing[0]?.id;
    if (!id) {
      const { data, error } = await admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${u.email}: ${error?.message}`);
      id = data.user.id;
    }
    // The auth.users trigger created the profile; set the preferences the onboarding would.
    const consentAt = u.ai_consent ? new Date().toISOString() : null;
    await platformSql()`
      update profiles set
        usage_style = ${u.usage_style}::usage_style,
        experience_level = ${u.experience_level}::experience_level,
        ai_consent_at = ${consentAt}::timestamptz,
        onboarding_step = 4,
        onboarding_completed_at = coalesce(onboarding_completed_at, now())
      where id = ${id}`;
    ctx.ids.users.push(id);
    console.log(`  ${u.email} → ${id}`);
  }
}

async function seedBulk(ctx: SeedContext): Promise<void> {
  const userId = ctx.ids.users?.[BULK_USER_INDEX];
  if (!userId) throw new Error('seedBulk needs the users seeder first');
  const ids = await seedBulkReadings(userId, ctx.bulk, ctx.seed);
  console.log(`  ${ids.length} generated readings for ${DEMO_USERS[BULK_USER_INDEX].email}`);
}

const SEEDERS: Seeder[] = [
  { name: 'users', phase: '01', run: seedUsers },
  { name: 'readings', phase: '03', run: seedReadings },
  { name: 'interpretations', phase: '04', run: seedInterpretations },
  { name: 'bulk readings', phase: '05', run: seedBulk },
];

async function main() {
  const { values } = parseArgs({
    options: {
      months: { type: 'string', default: '6' },
      seed: { type: 'string', default: '42' },
      bulk: { type: 'string', default: '1000' },
    },
  });
  const ctx: SeedContext = {
    months: Number(values.months),
    seed: Number(values.seed),
    bulk: Number(values.bulk),
    ids: {},
  };
  if (!Number.isFinite(ctx.months) || ctx.months < 1) throw new Error('--months must be ≥ 1');
  if (!Number.isFinite(ctx.bulk) || ctx.bulk < 0) throw new Error('--bulk must be ≥ 0');

  if (SEEDERS.length === 0) {
    console.log(`nothing to seed yet (months=${ctx.months}) — seeders register from Phase 01`);
    return;
  }
  for (const s of SEEDERS) {
    console.log(`seeding ${s.name} (phase ${s.phase})`);
    await s.run(ctx);
  }
  console.log('demo seed complete');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => closeAdmin());
