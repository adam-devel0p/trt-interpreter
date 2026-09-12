/**
 * Deletion registry (docs/PRIVACY_AND_DELETION.md#deletion-registry).
 *
 * For each root object type, every dependent artifact that must die with it. A test enumerates
 * every table in the Drizzle schema that carries a `user_id` column and fails if it is not
 * covered here — adding a user-owned table without registering its deletion path breaks CI.
 *
 * Phase 00: no product objects exist yet; only the platform `jobs` table and the throwaway
 * `smoke_notes` table are registered, both under the `user` root.
 */

export type RootType = 'reading' | 'life_event' | 'journey' | 'entity' | 'user';

export interface CascadeTarget {
  table: string;
  /** How the dependent is removed. `cascade` = FK on delete cascade; `job` = purge job step. */
  via: 'cascade' | 'job';
  note?: string;
}

export const DELETION_REGISTRY: Record<RootType, readonly CascadeTarget[]> = {
  reading: [],
  life_event: [],
  journey: [],
  entity: [],
  user: [
    { table: 'jobs', via: 'cascade', note: 'auth.users FK; payloads carry only IDs' },
    { table: 'smoke_notes', via: 'cascade', note: 'THROWAWAY — dropped in Phase 01' },
  ],
};

/** Tables that are global reference data (no user rows) and therefore exempt from the check. */
export const REFERENCE_TABLES: readonly string[] = [];

/** Every table named anywhere in the registry. */
export function coveredTables(): Set<string> {
  const set = new Set<string>();
  for (const targets of Object.values(DELETION_REGISTRY)) for (const t of targets) set.add(t.table);
  return set;
}
