/**
 * Deletion registry (docs/PRIVACY_AND_DELETION.md#deletion-registry).
 *
 * For each root object type, every dependent artifact that must die with it. A test enumerates
 * every table in the Drizzle schema that carries a `user_id` column and fails if it is not
 * covered here — adding a user-owned table without registering its deletion path breaks CI.
 *
 * Phase 01: no product objects exist yet; the platform `jobs` table and the identity tables
 * (`profiles`, `user_flags`, `reminder_settings`) are registered under the `user` root.
 * Phase 02: deck reference tables are global (no user rows) and listed in `REFERENCE_TABLES`;
 * `spreads` carries a nullable `user_id` for custom spreads, so it is registered.
 * Phase 03: `readings`, `reading_cards` (root `reading` and, via the denormalised column, the
 * user root) and `reading_drafts`.
 */

export type RootType = 'reading' | 'life_event' | 'journey' | 'entity' | 'user';

export interface CascadeTarget {
  table: string;
  /** How the dependent is removed. `cascade` = FK on delete cascade; `job` = purge job step. */
  via: 'cascade' | 'job';
  note?: string;
}

export const DELETION_REGISTRY: Record<RootType, readonly CascadeTarget[]> = {
  reading: [{ table: 'reading_cards', via: 'cascade', note: 'FK readings.id on delete cascade' }],
  life_event: [],
  journey: [],
  entity: [],
  user: [
    { table: 'jobs', via: 'cascade', note: 'auth.users FK; payloads carry only IDs' },
    {
      table: 'profiles',
      via: 'cascade',
      note: 'keyed by id = auth.users.id; holds no journal content',
    },
    { table: 'user_flags', via: 'cascade' },
    { table: 'reminder_settings', via: 'cascade' },
    { table: 'readings', via: 'cascade', note: 'auth.users FK; cascades to reading_cards' },
    {
      table: 'reading_cards',
      via: 'cascade',
      note: 'denormalised user_id FK as well as the parent',
    },
    { table: 'reading_drafts', via: 'cascade', note: 'one in-progress draft per user' },
    {
      table: 'spreads',
      via: 'cascade',
      note: 'custom spreads only; built-in rows have user_id null and are never deleted',
    },
  ],
};

/** Tables that are global reference data (no user rows) and therefore exempt from the check. */
export const REFERENCE_TABLES: readonly string[] = [
  'decks',
  'cards',
  'card_archetypes',
  'card_archetype_members',
  'card_aliases',
];

/** Every table named anywhere in the registry. */
export function coveredTables(): Set<string> {
  const set = new Set<string>();
  for (const targets of Object.values(DELETION_REGISTRY)) for (const t of targets) set.add(t.table);
  return set;
}
