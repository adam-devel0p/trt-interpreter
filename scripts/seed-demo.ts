import './_env';
import { parseArgs } from 'node:util';

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
  ids: Record<string, string[]>;
}

export interface Seeder {
  name: string;
  phase: string;
  run(ctx: SeedContext): Promise<void>;
}

const SEEDERS: Seeder[] = [
  // Phase 01: { name: 'users', phase: '01', run: seedUsers },
];

async function main() {
  const { values } = parseArgs({
    options: {
      months: { type: 'string', default: '6' },
      seed: { type: 'string', default: '42' },
    },
  });
  const ctx: SeedContext = {
    months: Number(values.months),
    seed: Number(values.seed),
    ids: {},
  };
  if (!Number.isFinite(ctx.months) || ctx.months < 1) throw new Error('--months must be ≥ 1');

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

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
