import './_env';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Prompt eval runner (docs/AI_LAYER.md#eval-suite). Never runs in CI — it costs money.
 * Discovers src/ai/tasks/<task>/fixtures/*.json; Phase 04 adds the real-provider loop and
 * checks (schema validity, deck purity, hedged register, citation integrity, refusal-to-invent).
 */
function main() {
  const tasksDir = path.resolve('src/ai/tasks');
  const tasks = existsSync(tasksDir)
    ? readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];
  const withFixtures = tasks.filter((t) => existsSync(path.join(tasksDir, t.name, 'fixtures')));
  if (withFixtures.length === 0) {
    console.log('no evals registered');
    return;
  }
  console.log(`found ${withFixtures.length} task(s) with fixtures; runner arrives in Phase 04`);
}

main();
