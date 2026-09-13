import './_env';
import { closeAdmin } from '../src/db/admin';
import { seedReferenceData } from '../src/db/seed/reference';

/**
 * Deck/spread reference data: RWS + Thoth (78 cards each), archetypes, aliases and the five
 * built-in spreads. Idempotent — safe to run on every deploy and before every test run.
 */
async function main() {
  const s = await seedReferenceData();
  console.log(
    `reference data seeded: ${s.decks} decks · ${s.cards} cards · ${s.archetypes} archetypes · ` +
      `${s.members} members · ${s.aliases} aliases · ${s.spreads} spreads · ${s.themes} themes`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => closeAdmin());
