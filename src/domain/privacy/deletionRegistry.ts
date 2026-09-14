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
 * Phase 08: life events. The `life_event` root mirrors the reading's derived tables (keyed by
 * `(object_type, object_id)`, removed by the purge job) plus `event_media` (rows cascade; the
 * bytes in the `event-media` bucket are removed by the job first), `links` (either side) and
 * `outcomes` (the user's record on the reading stays; its `life_event_id` is set null). The
 * `reading` root gains `outcomes` (cascade) and `links` (job, either side).
 * Phase 09: retrieval. `retrieval_documents` are keyed by `(object_type, object_id)` and die
 * with their object twice over — a database trigger on `readings` / `life_events` and the
 * purge job's explicit step (which verifies zero); `embeddings` cascade from their document
 * by FK. `asks` keep citations as object ids: the purge job scrubs every reference to the
 * deleted object out of `citations`, `claims`, `package_object_ids` and
 * `dropped_object_ids` (the question and the answer text stay — an answer about an entry
 * that is gone still names no content of it, and the user asked it). All three cascade
 * from the user.
 * Phase 10: summaries. `period_summaries` and `journey_narratives` keep `source_object_ids`:
 * deleting a source scrubs the id out of the set (and out of every claim's citations), marks
 * the row `stale_at`, and deletes a row whose set would be empty — by the
 * `summaries_source_cascade` trigger on `readings` / `life_events` and by the purge job's
 * explicit step (which verifies zero references). A summary's own retrieval document dies
 * with it by trigger. `retention_prompts` (ids only) referencing the object are deleted.
 * Journey-scoped summaries and narratives cascade from the journey. All cascade from the user.
 * The `purge_deleted` job (`src/privacy/purge.ts`) is driven by the `reading` and
 * `life_event` roots of this registry and a test asserts its receipt names every table listed.
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
    { table: 'outcomes', via: 'cascade', note: 'FK readings.id on delete cascade' },
    {
      table: 'links',
      via: 'job',
      note: 'either side; keyed by (from_type, from_id) / (to_type, to_id)',
    },
    {
      table: 'retrieval_documents',
      via: 'job',
      note: 'keyed by (object_type, object_id); also removed by the readings_retrieval_cascade trigger',
    },
    {
      table: 'embeddings',
      via: 'cascade',
      note: 'FK retrieval_documents.id on delete cascade — vectors die with the document',
    },
    {
      table: 'asks',
      via: 'job',
      note: 'citation scrub: every reference to the object is removed from citations, claims and package ids',
    },
    {
      table: 'period_summaries',
      via: 'job',
      note: 'source scrub: the id leaves source_object_ids, sources and every citation; the row is marked stale, or deleted when its set would be empty (also the summaries_source_cascade trigger)',
    },
    {
      table: 'journey_narratives',
      via: 'job',
      note: 'source scrub + stale, as for period_summaries (also the trigger)',
    },
    {
      table: 'retention_prompts',
      via: 'job',
      note: 'prompts pointing at the object (object_id or payload ids) are deleted (also the trigger)',
    },
  ],
  life_event: [
    {
      table: 'event_media',
      via: 'job',
      note: 'rows cascade from life_events; the storage objects under event-media/<user>/<event>/ are removed by the job first',
    },
    { table: 'extractions', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'metadata_overrides', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'object_themes', via: 'job', note: 'keyed by (object_type, object_id)' },
    { table: 'entity_mentions', via: 'job', note: 'keyed by (object_type, object_id)' },
    {
      table: 'journey_members',
      via: 'job',
      note: 'keyed by (object_type, object_id); the journeys it sat in are refreshed after',
    },
    { table: 'links', via: 'job', note: 'either side' },
    {
      table: 'outcomes',
      via: 'cascade',
      note: 'FK life_events.id on delete set null — the outcome is the user’s record on the reading and stays',
    },
    {
      table: 'retrieval_documents',
      via: 'job',
      note: 'keyed by (object_type, object_id); also removed by the life_events_retrieval_cascade trigger',
    },
    { table: 'embeddings', via: 'cascade', note: 'FK retrieval_documents.id on delete cascade' },
    { table: 'asks', via: 'job', note: 'citation scrub, as for readings' },
    { table: 'period_summaries', via: 'job', note: 'source scrub + stale, as for readings' },
    { table: 'journey_narratives', via: 'job', note: 'source scrub + stale, as for readings' },
    { table: 'retention_prompts', via: 'job', note: 'as for readings' },
  ],
  journey: [
    { table: 'journey_members', via: 'cascade', note: 'FK journeys.id on delete cascade' },
    {
      table: 'period_summaries',
      via: 'cascade',
      note: 'journey-scoped summaries: FK journeys.id on delete cascade',
    },
    { table: 'journey_narratives', via: 'cascade', note: 'FK journeys.id on delete cascade' },
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
    { table: 'life_events', via: 'cascade', note: 'auth.users FK; cascades to event_media' },
    {
      table: 'event_media',
      via: 'job',
      note: 'rows cascade; the bytes under event-media/<user_id>/ are in STORAGE_PREFIXES for the account job',
    },
    { table: 'outcomes', via: 'cascade', note: 'user-recorded facts' },
    { table: 'links', via: 'cascade', note: 'scores, signals and reasons; ids only' },
    { table: 'retrieval_documents', via: 'cascade', note: 'compact template text; never notes' },
    { table: 'embeddings', via: 'cascade', note: 'vectors and model ids' },
    { table: 'asks', via: 'cascade', note: 'the user’s questions, answers and citations' },
    { table: 'period_summaries', via: 'cascade', note: 'generated summaries with source ids' },
    { table: 'journey_narratives', via: 'cascade', note: 'generated header sentences' },
    { table: 'retention_prompts', via: 'cascade', note: 'ids and days only' },
  ],
};

/**
 * Storage prefixes that hold user-owned bytes. Not tables, so the structural check cannot see
 * them; listed here so the account-deletion job has one place to read.
 */
export const STORAGE_PREFIXES: readonly { bucket: string; prefix: (userId: string) => string }[] = [
  { bucket: 'exports', prefix: (userId) => `${userId}/` },
  { bucket: 'event-media', prefix: (userId) => `${userId}/` },
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
