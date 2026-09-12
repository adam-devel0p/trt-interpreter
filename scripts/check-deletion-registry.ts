/**
 * CI gate (docs/PRIVACY_AND_DELETION.md): every table in the Drizzle schema that carries a
 * `user_id` column must appear in the deletion registry. Runs as part of `pnpm lint` and as a
 * unit test, so it is impossible to forget.
 */
import { userOwnedTablesMissingFromRegistry } from '../src/domain/privacy/registryCheck';
import * as schema from '../src/db/schema';

const missing = userOwnedTablesMissingFromRegistry(schema);
if (missing.length > 0) {
  console.error(
    `Deletion registry is missing user-owned table(s): ${missing.join(', ')}\n` +
      'Register each in src/domain/privacy/deletionRegistry.ts.',
  );
  process.exit(1);
}
console.log('check-deletion-registry: ok');
