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
 * Phase 04: `interpretations`, `question_embeddings` (cascade from the reading and the user),
 * `safety_flags` (user cascade; keyed by object id, purged with the object in Phase 05's job)
 * and the platform `ai_calls` (user_id set null on account deletion — it holds no content).
 * Phase 05: `reading_note_revisions` (cascade from the reading and the user),
 * `deletion_receipts` (user_id set null — a receipt outlives the account and holds only
 * counts), `exports` (cascade; the archive in the `exports` bucket is removed by the job).
 * Phase 06: the structured-memory tables. Under the `reading` root, `predictions` cascade by
 * FK while `extractions`, `metadata_overrides`, `object_themes` and `entity_mentions` are keyed
 * by `(object_type, object_id)` and removed by the purge job. The `entity` root is populated:
 * aliases, roles and mentions cascade from `entities`; `entity_merges` hold ids only and are
 * removed by the entity delete path. `themes` (user rows) cascade from the user.
 * Phase 07: journeys. `journey_members` are keyed by `(object_type, object_id)` and removed
 * by the purge job (which then refreshes the journeys they sat in, so progression steps
 * lose the deleted source); the `journey` root holds members and progression steps
 * (cascade). Deleting a journey never deletes its readings.
 * The `purge_deleted` job (`src/privacy/purge.ts`) is driven by the `reading` root of this
 * registry and a test asserts its receipt names every table listed here.
 */

export type RootType = 'reading' | 'life_event' | 'journey' | 'entity' | 'user';

export interface CascadeTarget {
  table: string;
  /** How the dependent is removed. `cascade` = FK on delete cascade; `job` = purge job step. */
  via: 'cascade' | 'job';
  note?: string;
}

export const DELETION_REGISTRY: Record<RootType, readonly CascadeTarget[]> = {
  reading: [
    { table: 'reading_cards', via: 'cascade', note: 'FK readings.id on delete cascade' },
    { table: 'interpretations', via: 'cascade', note: 'FK readings.id on delete cascade' },
    { table: 'question_embeddings', via: 'cascade', note: 'FK readings.id on delete cascade' },
    {
      table: 'safety_flags',
      via: 'job',
      note: 'keyed by (object_type, object_id); the purge job removes them with the reading',
    },
    {
      table: 'reading_note_revisions',
      via: 'cascade',
      note: 'FK readings.id on delete cascade; every previous value of the user text',
    },
    { table: 'extractions', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'metadata_overrides', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'object_themes', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'entity_mentions', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'predictions', via: 'cascade', note: 'FK readings.id on delete cascade' },
    {
      table: 'journey_members',
      via: 'job',
      note: 'keyed by (object_type, object_id); the journeys they sat in are refreshed after',
    },
  ],
  life_event: [],
  journey: [
    { table: 'journey_members', via: 'cascade', note: 'FK journeys.id on delete cascade' },
    {
      table: 'journey_theme_progression',
      via: 'cascade',
      note: 'FK journeys.id on delete cascade; member readings are never deleted',
    },
  ],
  entity: [
    { table: 'entity_aliases', via: 'cascade', note: 'FK entities.id on delete cascade' },
    { table: 'entity_roles', via: 'cascade', note: 'FK entities.id on delete cascade' },
    { table: 'entity_mentions', via: 'cascade', note: 'FK entities.id on delete cascade' },
    {
      table: 'entity_merges',
      via: 'job',
      note: 'ids only, no FK; removed by deleteEntity() for either side of the merge',
    },
  ],
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
    { table: 'interpretations', via: 'cascade' },
    { table: 'safety_flags', via: 'cascade', note: 'category + IDs only' },
    { table: 'question_embeddings', via: 'cascade', note: 'hash + vector only' },
    {
      table: 'ai_calls',
      via: 'cascade',
      note: 'user_id set null on delete; rows hold counts and classes, no content',
    },
    { table: 'reading_note_revisions', via: 'cascade' },
    {
      table: 'deletion_receipts',
      via: 'cascade',
      note: 'user_id set null on delete; counts and IDs only, so the receipt outlives the account',
    },
    {
      table: 'exports',
      via: 'job',
      note: 'rows cascade from auth.users; the archives under exports/<user_id>/ are storage objects the account-deletion job (Phase 12) must remove',
    },
    { table: 'extractions', via: 'cascade', note: 'derived payloads, versioned' },
    { table: 'metadata_overrides', via: 'cascade', note: "the user's corrections" },
    {
      table: 'themes',
      via: 'cascade',
      note: 'user-scoped rows only; curated rows have user_id null',
    },
    { table: 'object_themes', via: 'cascade' },
    { table: 'entities', via: 'cascade' },
    { table: 'entity_aliases', via: 'cascade' },
    { table: 'entity_roles', via: 'cascade' },
    { table: 'entity_mentions', via: 'cascade' },
    { table: 'entity_merges', via: 'cascade', note: 'ids only' },
    { table: 'predictions', via: 'cascade', note: 'POSSIBILITY rows; no probability ever' },
    { table: 'journeys', via: 'cascade' },
    { table: 'journey_members', via: 'cascade' },
    { table: 'journey_theme_progression', via: 'cascade', note: 'evidence ids only' },
  ],
};

/**
 * Storage prefixes that hold user-owned bytes. Not tables, so the structural check cannot see
 * them; listed here so the account-deletion job has one place to read.
 */
export const STORAGE_PREFIXES: readonly { bucket: string; prefix: (userId: string) => string }[] = [
  { bucket: 'exports', prefix: (userId) => `${userId}/` },
];

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
