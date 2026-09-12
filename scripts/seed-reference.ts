import './_env';

/**
 * Deck/spread reference data (idempotent). Phase 02 fills this in with RWS + Thoth cards,
 * archetypes, aliases and the five built-in spreads.
 */
async function main() {
  console.log('no reference data yet — Phase 02 seeds decks, cards and spreads');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
