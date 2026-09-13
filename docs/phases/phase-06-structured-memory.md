# Phase 06 — Structured Memory: Extraction, Entities, Corrections

**Deps:** 05 · **Spec:** §7, §7.1, §7.2, FR-08, FR-09, FR-26, FR-27, §9.2 · **Outcome:** saved readings
quietly grow structured memory — themes, entities with stable IDs and aliases, temporal roles,
predictions — all versioned, all correctable, and the user never files anything by hand.

> This is the first phase where the app makes claims about the user's life. The fact-status model and
> the correction paths are not optional polish here; they are the feature.

## Scope

**In:** `extract_reading_metadata`, `extractions`, `metadata_overrides`, `themes`/`object_themes`,
`entities`/`entity_aliases`/`entity_roles`/`entity_mentions`, `predictions`, entity resolution,
merge/split, correction UI, reprocessing job.

**Out:** journeys (07 — extraction emits `journey_candidates` and stores them unused for now), event
extraction (08), retrieval (09).

## Tasks

From Phase 05 (see [completed/phase-05-report.md](completed/phase-05-report.md) §13):
- The journal reads through `searchJournal(client, filters, opts)` (`src/db/queries/journal.ts`)
  → `{ items, nextCursor, matchedCardIds }`, backed by the `search_readings(p jsonb)` Postgres
  function. An entity/theme filter is: a key in `journalFiltersSchema` + `URL_KEYS`
  (`src/domain/journal/filters.ts`), a parameter + `EXISTS` clause in the function (new
  migration), and a select in `app/(app)/journal/filters.tsx`. The URL, cursor and list need
  nothing else. Nothing on that route may import `src/ai/` (invariant scan).
- **The deletion registry is executable.** Every new table under the `reading` root needs a
  counter in `READING_DEPENDENT_COUNTERS` (`src/privacy/purge.ts`), and `via: 'job'` targets a
  remover, or `deleting-reading-purges-derived` fails. `entity` root tables need the same
  pattern (a purge path and a receipt) when they land; the `reading_id`-FK scan in that test
  lists the migrations to read — add `0007_…`.
- **Export:** a new object type is a name in `EXPORT_FILES`, a schema in `EXPORT_FILE_SCHEMAS`
  (`src/domain/export/schema.ts`), a collector in `buildExportArchive()` (`src/export/build.ts`)
  and a `LINK_KINDS` entry; the round-trip test validates every file. Extractions and entities
  belong in the export (they are the user's derived artifacts, with versions).
- **Delete AI artifacts:** add `extractions` (and whatever else is model-derived) to
  `AI_ARTIFACT_TABLES` in `src/privacy/aiArtifacts.ts`; each needs an owner delete policy.
- **Invariant 4 is a trigger** (`readings_keep_text`); derived-side modules (`src/ai`,
  `src/interpretation`, `src/jobs`, `src/privacy`, `src/export`) must never write `readings` or
  `reading_cards` — `raw-text-never-overwritten` scans for it. Extraction reads text, never
  rewrites it.
- `readings.metadata_version` bumps on card, deck, spread **and question** edits; an extraction
  keyed on it is stale on any of those — reprocess, never silently keep.
- Jobs: `enqueue()` then `runBatch({ jobId })` runs one job immediately with cron as the retry
  path (the delete and export actions do this). Extraction after save should stay a queued job
  (never in the request path) — the cron batch picks it up.
- Fixtures: `src/__tests__/fixtures/journal-db.ts` (`makeReading`, `storeInterpretation`,
  `attachDerived`) and `e2e/_helpers.ts` `seedReadings()`; scope the e2e `ai_calls` spy to the
  test's `user_id`. `demo-cleo` has 1000 generated readings (`pnpm demo:seed --bulk N`).

### 1. Schema
All tables per [../DATA_MODEL.md](../DATA_MODEL.md#derived-metadata--phase-06), RLS on each. Trigram
index on `entity_aliases.alias_normalized`. `predictions.fact_status` fixed to `POSSIBILITY` by check
constraint — **no probability column, ever** (§10).

### 2. Extraction (§7.2, FR-08)
- `extract_reading_metadata` task; payload schema exactly as documented in
  [../DATA_MODEL.md](../DATA_MODEL.md#derived-metadata--phase-06), Zod-validated, `SCHEMA_VERSION` = 1.
- Runs as a **job after save** (never in the request path). Reading is usable before, during and after.
- Append-only: a new extraction supersedes the previous one; nothing is deleted, so a regression is
  diagnosable and history can be reprocessed under a newer schema (§7.2).
- Raw text is input only; it is never rewritten by extraction (invariant 4).
- Gated by `flags.ai_extraction` and by `profiles.ai_consent_at` — no consent, no extraction.

### 3. Entity resolution (§7.1, FR-09)
Implement exactly [../ALGORITHMS.md](../ALGORITHMS.md#1-entity-resolution-71-fr-09):
- Candidate generation (exact alias → trigram → embedding → structural priors); pronouns never resolve
  on their own.
- Deterministic scoring in `src/domain/entities/resolve.ts` — pure, heavily fixture-tested.
- Thresholds: ≥0.85 auto-link · 0.60–0.85 tentative · ambiguous-and-history-changing → ask · <0.60 new
  entity.
- **Tentative entities may never be stated as confirmed fact** in any generated text — enforced by
  passing only `resolution IN ('auto','user')` entities into prompt context, with a test.
- Disambiguation is at most one question per save, queued onto the reading detail screen, never a modal
  mid-flow (§4.1).
- Temporal roles: `entity_roles` with `valid_from`/`valid_to`; a changed role **adds** a row and closes
  the previous one rather than overwriting (§7.1).

### 4. Corrections (FR-26, FR-27)
- **Edit extracted metadata:** every inferred chip (life area, theme, entity, prediction, timeframe) is
  editable and dismissible on the reading detail screen. Corrections write `metadata_overrides` and are
  **user-authoritative** — they survive re-extraction and re-processing (read path layers overrides on
  top of the newest extraction).
- **Merge entities:** aliases and mentions move; roles with conflicting ranges are preserved separately;
  dependent links re-scored; a merge receipt enables undo.
- **Split entity:** user picks the mentions that belong elsewhere; new entity created; dependents
  re-evaluated.
- Any user action sets `user_confirmed` and pins the entity against future automatic changes.

### 5. Entities UI
- Entity list in Profile (or Journal sub-tab): canonical label, kind, alias count, first/last seen,
  "used in N readings".
- Entity detail: aliases (add/remove), roles with date ranges, mentions with source links, merge/split
  actions, rename.
- Every inferred value carries the standard inferred treatment + "why am I seeing this?" showing the
  actual evidence (§4.4).

### 6. Reprocessing
`reprocess_extractions --object-type=reading --to-schema=N` job: walks raw text forward, writes new
extractions, preserves overrides, reports counts. Test it by bumping the schema version in a fixture.

### 7. Demo data
Seed coherent entities across the 6-month history — a recurring person with two aliases and a role
change, an employer, a place — so 07/08/09 have real material.

## Test plan

- [ ] **Unit (heaviest coverage of any phase)** — `fixtures/history/` cases: "my girlfriend" then
      "Alex" resolve to one entity; "Alex" (friend) vs "Alex" (colleague) stays ambiguous and asks;
      bare "she" never creates or resolves an entity alone; a role change from partner → ex-partner
      preserves the historical range; scores sit on the right side of every threshold.
- [ ] Integration: extraction job persists a versioned payload; a second extraction supersedes without
      deleting; overrides survive re-extraction; extraction failure leaves the reading untouched and
      retries; no-consent users get no extraction.
- [ ] Merge/split: aliases and mentions move correctly; conflicting roles both survive; dependent links
      re-scored; undo restores prior state.
- [ ] **Invariant `alias-merge-preserves-historical-roles.test.ts` — unskip and pass.**
- [ ] **Invariant `model-cannot-create-confirmed-fact.test.ts`** extended: extracted entities, themes
      and predictions are born non-confirmed; only a user action promotes them.
- [ ] Tentative-entity exclusion: a prompt-context builder test asserts tentative entities are absent.
- [ ] **RLS** on all seven new tables, including `entity_mentions` and `metadata_overrides`.
- [ ] E2E at 390px: save a reading → see inferred chips appear (polled or live) → correct a theme →
      reload and confirm the correction persisted → merge two entities → verify affected readings.
- [ ] a11y: inferred chips are labeled as inferred in text; correction controls keyboard-reachable;
      merge flow announces its outcome.
- [ ] `pnpm eval`: extraction fixtures score on entity recall/precision and theme sanity; record the
      numbers as the baseline for future prompt changes.

Manual:
- [ ] Read the extracted metadata for 10 seeded readings. Wrong-but-confident extraction is the main
      risk — if precision is poor, raise thresholds toward tentative rather than shipping confident
      errors (§4.4).

## Exit criteria

- [ ] Extraction runs post-save, versioned, append-only, consent- and flag-gated.
- [ ] Entity resolution implemented to documented thresholds with fixture tests on every boundary.
- [ ] Temporal roles never overwritten; merge/split work with re-scoring and undo.
- [ ] Corrections are user-authoritative and survive reprocessing.
- [ ] Tentative entities excluded from generated claims.
- [ ] Entities UI usable and honest about inference.
- [ ] Report (include extraction quality numbers) + `../PROGRESS.md` + `../ALGORITHMS.md` updated with
      any threshold changes and the reasoning.
