# Phase 06 — Completion Report

**Status:** complete with deferrals (real-model eval needs provider keys — owner)
**Date:** 2026-09-13
**Phase file:** [../phase-06-structured-memory.md](../phase-06-structured-memory.md)

---

## 1. What was built

Saved readings now quietly grow structured memory. After a save (and after a question, card,
deck, spread or notes edit) the action *enqueues* `extract_reading_metadata`; the cron batch runs
it, never the request. The run gates on consent and the `ai_extraction` flag, writes a `pending`
`extractions` row before the model call, validates the payload against the versioned Zod schema
(`extraction/1.0.0` — strict, no probability field anywhere), **materialises** it, and only then
marks the row complete and supersedes the previous one; nothing is ever deleted, so a
regression is diagnosable and history can be reprocessed (`reprocess_extractions`,
`pnpm jobs:reprocess`). Materialisation is model-free and idempotent: themes land on a curated,
seeded taxonomy (free-text labels become user-scoped themes), possibilities become
`POSSIBILITY` predictions with stable ids, and every entity mention goes through the pure
resolver in `src/domain/entities/resolve.ts` — exact alias / trigram / name↔descriptor / role
channels, recency and kind, the documented 0.85 / 0.60 / 0.08 thresholds, "changes history" for
asking — producing `auto`, `tentative`, one open question per reading, or a new entity born
unconfirmed with its alias and a dated role. Roles are temporal and never rewritten (a trigger
refuses it). The reading detail's *Connections* section shows every inferred value as a chip
labelled "suggested" / "possibly" with "why?" naming the actual evidence, and one-tap
corrections — set, keep, dismiss, relink, "someone new", answer the question — each a
`metadata_overrides` row that survives every re-extraction and reprocess. A *People & places*
area under Profile lists the entities and lets the user rename, add or remove names, add or close
roles, merge (transactional, with a receipt and undo), split and remove. Prompt context for later
phases takes entities only from `src/memory/context.ts`, which excludes tentative ones by
construction. Delete-AI-artifacts, the export (`export/1.1.0`), the deletion registry and the
purge cover all ten new tables; the demo journal carries a partner named four ways with a
partner → ex-partner role change, an employer, a city, a live merge receipt and a relink.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **`propose_entity_candidates` is folded into `extract_reading_metadata`** (the `entities[]` array carries mention, kind, relation, context) | One model call per save instead of two; the model only ever *proposes* surface forms — identity is decided by `domain/entities/resolve.ts` either way. The `TaskId` stays reserved; AI_LAYER.md says so. | A second `fast` call per save. |
| **Materialise first, then mark complete** (in one transaction with the supersede) | The first e2e run polled the memory route in the ~50 ms between "row complete" and "rows written" and rendered an empty-but-ready panel, then stopped polling. Ordering the writes removes the race for every reader, not just the panel. | A `materialized_at` flag, or polling heuristics. |
| **Unavailable resolution signals are renormalised out** (journey overlap until 07, embeddings until 09) | With the documented weights and no journeys, the best possible score was exactly 0.85 and only at recency 1.0 — nothing would ever auto-link. Dropping the missing weight and rescaling keeps every threshold meaningful now and unchanged later. | Lower thresholds now and raise them in 07 (a moving contract). |
| **Name ↔ descriptor channel at 0.85 (+ rename), successor descriptor at 0.6, exact-alias dominance floored to `0.85 + 0.15·raw`, role families instead of "any other role conflicts"** | Found by tracing the `fixtures/history/` arcs by hand: "my girlfriend" then "Alex, my girlfriend" must collapse; "Leeds" a year later is still Leeds; a colleague being called a friend is new information, not another person; "my ex" should be a *tentative* nudge toward the partner. A plain floor of 0.85 produced exact ties between two Alexes decided by row order (a flake the merge integration test caught); folding the raw score in keeps the ranking. All in ALGORITHMS.md §1 with reasoning. | The literal five-line formula, which filed real journals wrongly on every arc. |
| **A tentative link changes nothing on the entity** (no alias, no role, no rename, no last-seen) | A tentative alias would make the next mention an *exact* match and the guess would confirm itself. Only `auto` and user actions touch the entity. | Recording tentative aliases with low confidence. |
| **A mention already resolved by the current extraction keeps its decision; only a new extraction re-resolves** | A correction elsewhere re-materialises the reading; re-scoring every `auto` link on every correction could silently flip links the user has been looking at. | Full re-resolution on every materialise. |
| **Corrections are override rows + a re-materialisation, one code path** (`memory/corrections.ts`) | The read path and the tables always agree, and "survives reprocessing" is true by construction rather than by a second implementation. | Editing derived rows directly from the UI. |
| **Merge / undo / split are Postgres functions executing a plan the domain computed** (`apply_entity_merge`, `undo_entity_merge`, `apply_entity_split`, SECURITY INVOKER) | The plan (which ids move, which are duplicates) is pure and unit-tested; the function makes it atomic and RLS-scoped, and snapshots dropped duplicates so undo is exact. Same pattern as `replace_reading_cards`. | A sequence of PostgREST writes (half a merge on failure). |
| **`entity_roles` are immutable by trigger** (only `entity_id` and a first `valid_to` may change) | §7.1's "valid_from/valid_to rather than overwritten" becomes a property of the data, whichever code path writes. The invariant test greps for it. | Application discipline only. |
| **AI-backed job handlers are loaded lazily by the registry**; payload schemas live in `handlers/payloads.ts` | `enqueue()` and `runBatch({jobId})` are called from the reading and journal actions, which must stay AI-free on the import graph. The `opening-reading-makes-no-ai-call` scan follows every import except the registry's `import()` edges, and asserts the extraction handler is unreachable. | Exempting `src/jobs` from the scan. |
| **`ai_extraction` stays off by env default; the demo seed and e2e opt users in through `user_flags`** | The phase file says flag-gated; the owner flips the default after the real-model eval. The rollout mechanism from Phase 01 is exactly the tool. | Turning the env default on. |
| **Delete-AI-artifacts keeps corrections, confirmed themes, user-linked mentions, edited predictions, confirmed entities and merge receipts** | "Keep every word" now also means "keep every correction"; they re-apply on the next extraction. | Wiping every derived row. |
| **Predictions are keyed by `(reading_id, text_hash)`; a dismissal keeps the row with `dismissed_at`; rows a reprocess no longer produces stay** | Phase 08 outcomes will reference prediction ids; stability beats tidiness. Retraction semantics are 08's call. | Deleting and re-creating on every run. |
| **The entity filter deferred from 05 landed** (`entity=` in the journal URL, `EXISTS` on `entity_mentions`, a *Mentions* select shown only when the user has entities) | It was three small edits on the seams Phase 05 left; a journey filter follows in 07 the same way. | Leaving it for 07. |
| `listRecentCardIds` orders by `position_index` after `created_at` (Phase 03 code) | Cards of one reading share a `created_at` (one transaction); the Phase 03 integration test relied on heap order and started failing once this phase's tests churned rows. | Loosening the test. |
| The reading flow cancels the debounced server-draft write on Save and sweeps once after | A draft write landing mid-save resurrected the draft after the save deleted it; the slightly longer save (an enqueue) made the pre-existing race visible in e2e. | Ignoring a 1-in-20 flake. |

## 3. Files and modules

```
src/domain/
  extraction/schema.ts ★         ExtractionPayload (Zod, strict, extraction/1.0.0), kinds, categories
  extraction/overrides.ts ★      override value union, overrideKey.*, parseOverride, applyOverrides → EffectiveMetadata
  extraction/hash.ts             fnv1a, textKey (prediction ids), sourceHash (question + notes)
  themes/taxonomy.ts             30 curated themes with synonyms; resolveThemeLabel, slugifyTheme
  entities/resolve.ts ★          candidates → signals → score → Decision (auto | tentative | ask | new | drop)
  entities/thresholds.ts ★       AUTO_LINK 0.85, AUTO_MARGIN 0.15, TENTATIVE 0.60, AMBIGUOUS_MARGIN 0.08, channel values, WEIGHTS
  entities/relations.ts          role lexicon (partner, ex_partner, manager, employer, …), succession, families
  entities/normalize.ts          normalizeAlias, isPronoun, looksLikeName
  entities/roles.ts              planRoleChange (add + close, never rewrite), activeRolesOn
  entities/merge.ts              planMerge (duplicates vs moves; conflicting role ranges kept), planSplit
  entities/apply.ts              planApply: Decision → EntityMutation (shared by DB and simulator)
  entities/trigram.ts            pg_trgm mirror for tests and the mock
  facts/writeGate.ts             + modelBorn() for tables without fact_status
  privacy/deletionRegistry.ts    + 10 tables under reading / entity / user roots
  journal/filters.ts             + entity filter key
  export/schema.ts               export/1.1.0: 7 new files, 8 new link kinds

src/ai/tasks/extract_reading_metadata/ ★  prompt.ts, schema.ts, version.ts, index.ts (buildExtractRequest), mock.ts (rule-based), fixtures/ (4 evals + baselines)
src/ai/index.ts                  task registered (versions + mock fixture)

src/memory/ ★
  extract.ts                     runExtraction: gates → pending → runObject → materialise → complete/supersede
  materialize.ts                 materializeReading: themes, mentions/entities/aliases/roles, predictions; overrides layered
  candidates.ts                  loadCandidates + pg_trgm similarities per mention
  corrections.ts                 correctionSchema, applyCorrection (override as user → rematerialise)
  context.ts / context.server.ts buildEntityContext (auto + user only) and its DB reader

src/jobs/
  handlers/payloads.ts           extract_reading_metadata / reprocess_extractions payload schemas
  handlers/extract-reading.ts    the job (retry only on timeout / provider error)
  handlers/reprocess-extractions.ts  bounded walk to the target schema, self-enqueueing
  handlers/index.ts              lazy registry (HandlerEntry.load)
  enqueue.ts                     + dedupe option; worker.ts loads handlers lazily

src/db/
  schema/memory.ts ★             10 tables with policies and checks
  migrations/0007_structured_memory.sql ★  DDL + updated_at triggers, entity_roles_immutable, search_readings(entity_id), apply_entity_merge, undo_entity_merge, apply_entity_split
  queries/memory.ts ★            getReadingMemory, listExtractions, upsert/deleteOverride, listEntities, getEntity, rename/notes/alias/role, mergeEntities, undoMerge, splitEntity, deleteEntity
  queries/journal.ts             entity_id passed to search_readings
  seed/reference.ts              curated themes seeded (idempotent)
  queries/readings.ts            listRecentCardIds tie-break

src/flags/server.ts              flagForUser (no request scope) — flag() reuses it
src/privacy/purge.ts             counters + removers for the 4 polymorphic tables; predictions counter
src/privacy/aiArtifacts.ts       AI_ARTIFACT_TARGETS with per-table filters
src/export/build.ts              7 new files + links

app/(app)/reading/
  actions.ts                     queueExtraction after save / edit / notes (dedupe, 60 s delay for notes)
  memory-actions.ts ★            correctMetadataAction, retryExtractionAction, listEntityOptionsAction
  [id]/memory-panel.tsx ★        the Connections island (chips, corrections, ask, polling, states)
  [id]/page.tsx                  memory + flag loaded; connections slot
  new/reading-flow.tsx           draft-timer cancel on save
app/(app)/profile/
  page.tsx                       People & places row; artifact counts typed
  privacy-controls.tsx           delete-AI-artifacts copy names the new counts
  entities/page.tsx ★            list grouped by kind
  entities/actions.ts ★          rename, notes, alias, role, merge, undo, split, delete
  entities/[id]/page.tsx ★, controls.tsx ★  detail + corrections
app/(app)/journal/               entities passed to filters; Mentions select
app/api/readings/[id]/memory/route.ts  polling read (rows only)
src/ui/components/inferred-chip.tsx  label ('suggested' | 'possibly'), onKeep, correctLabel
src/ui/components/reading-detail.tsx connections slot

scripts/
  seed-demo-memory.ts ★          extraction over the demo journal + a merge (as the user) + a relink
  seed-demo-readings.ts          three of Ana's notes name Maya / my girlfriend / my ex
  jobs-reprocess.ts              pnpm jobs:reprocess --to-schema=…
  eval.ts                        extraction fixtures: entity recall / precision, theme sanity, baselines
fixtures/history/                relationship-arc, career-arc, relocation-arc

Tests: src/domain/entities/__tests__/{resolve,entities}.test.ts (+ simulate.ts),
  src/domain/extraction/__tests__/extraction.test.ts, src/memory/__tests__/{context.test,extraction.integration.test}.ts,
  src/db/__tests__/memory.rls.test.ts, src/__tests__/invariants/alias-merge-preserves-historical-roles.{test,integration.test}.ts,
  model-cannot-create-confirmed-fact (+1 case), raw-text-never-overwritten (+src/memory), opening-reading-makes-no-ai-call (entry points, lazy edge),
  deleting-reading-purges-derived (+5 tables, integration with memory rows), export.integration (+7 files), deletion-registry, journal filters,
  src/__tests__/fixtures/memory-db.ts, journal-db.ts (attachDerived { memory }), e2e/memory.spec.ts, e2e/_helpers.ts (extraction flag, runJobs)
```

## 4. Database changes

`0007_structured_memory.sql` (`drizzle-kit generate --name structured_memory`, hand-written after
the marker), applied on a reset local database:

- Tables: `extractions` (19 cols; checks on object_type, status, complete-needs-payload+model; partial unique `extractions_current_idx`), `metadata_overrides` (unique `(object_type, object_id, field_path)`), `themes` (unique `(user_id, slug) NULLS NOT DISTINCT`, category check), `object_themes` (unique per object+theme, weight check), `entities` (status check, `merged ⇔ merged_into_id`, self FK set null, trigram GIN on label), `entity_aliases` (unique per entity+normalised, trigram GIN on `alias_normalized`), `entity_roles` (`valid_to >= valid_from`), `entity_mentions` (resolution check, unique per object+normalised, `ask_candidates uuid[]`, `signals`, `reasons`), `entity_merges` (snapshot jsonb, no FKs), `predictions` (`fact_status = 'POSSIBILITY'` check, unique `(reading_id, text_hash)`, FK readings cascade). Every table RLS-enabled; `extractions` select+delete, `themes` curated-or-own read / own write, the rest four policies with parent `exists` checks (readings for polymorphic rows, entities for aliases/roles/mentions — mentions check both).
- Triggers: `set_updated_at` on `metadata_overrides`, `entities`, `predictions`; **`entity_roles_immutable`** (raises `23514` on a change to role / valid_from / source / an already-set valid_to).
- Functions: `apply_entity_merge(uuid, uuid, jsonb) → uuid`, `undo_entity_merge(uuid)`, `apply_entity_split(uuid, text, entity_kind, jsonb) → uuid` — SECURITY INVOKER, granted to `authenticated, service_role`; `search_readings(jsonb)` replaced with the `entity_id` filter.
- Seed: 30 curated `themes` rows (`pnpm db:seed`, idempotent upsert on `(user_id, slug)`).
- Deletion registry: `reading` root + `extractions`, `metadata_overrides`, `object_themes`, `entity_mentions` (job) and `predictions` (cascade); `entity` root populated; `user` root + all ten. `deleting-reading-purges-derived` lists `0007` in its FK scan and expects the five job targets.

DATA_MODEL.md's Phase 06 section was rewritten to the built shape (it had `extractions` without
`source_hash`/`metadata_version`, no `entity_merges`, `entity_roles.valid_from` unspecified,
`predictions` without `text_hash`/`dismissed_at`).

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|
| `extract_reading_metadata` | `extract_reading_metadata/1.0.0` | `extraction/1.0.0` | standard | New. System prompt names every key, forbids pronoun mentions and invented names, asks for taxonomy labels first, phrases possibilities as possibilities, treats cards as context not evidence. `maxTokens` 1400. Mock: rule-based (descriptors, capitalised names, initials, places after prepositions or movement verbs, keyword themes, question-shaped possibilities). |
| `propose_entity_candidates` | — | — | — | Folded into the above (decision 1). |

Eval (`pnpm eval --dry`, mock provider — no keys in any environment): 4 fixtures, **entity
recall 100 %, precision 88 %** over 7 expected mentions (the extra is "my manager", a descriptor
for the expected Priya); no pronoun proposed; every theme on the taxonomy; thin open reflection
extracts nothing; no probability anywhere. Baselines in
`src/ai/tasks/extract_reading_metadata/fixtures/__baselines__/` with empty `human_review`
blocks. **The real-model run and the human read of the baselines are owner tasks** (deferred,
as in Phase 04).

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `AUTO_LINK` / `AUTO_MARGIN` | `domain/entities/thresholds.ts` | 0.85 / 0.15 | ALGORITHMS §1 as written; boundary tests |
| `TENTATIVE` / `AMBIGUOUS_MARGIN` | same | 0.60 / 0.08 | as written; two same-name entities with different roles land at margin 0.025 → ask |
| `TRIGRAM_MIN` / `EMBEDDING_MIN` | same | 0.45 / 0.75 | as written; "Sami"→"Sam" 0.50 tentative, "Samantha"→"Sam" 0.30 new |
| `WEIGHTS` | same | 0.35 / 0.20 / 0.15 / 0.15 / 0.15 | as written; unavailable signals renormalised out |
| `ALIAS_EXACT` / `ALIAS_NAMES_DESCRIPTOR` / `ALIAS_TRIGRAM` / `ALIAS_ROLE_SUCCESSOR` / `ALIAS_EMBEDDING` | same | 1.0 / 0.85 / 0.7 / 0.6 / 0.4 | new channels (decision 4); traced scores in the report's §8 |
| Role consistency values | `resolve.ts` | 1.0 / 0.8 / 0.6 / 0.5 / 0.4 / 0.0 | families (decision 4) |
| Exact-alias floor | `resolve.ts` | `0.85 + 0.15·raw` | order-preserving (a plain floor tied and flaked) |
| `RECENCY_HALF_DAYS` | thresholds | 120 | as written |
| `MAX_ASKS_PER_OBJECT` | thresholds | 1 | §4.1 |
| `NOTES_EXTRACTION_DELAY_MS` | `reading/actions.ts` | 60 s (+ dedupe) | one extraction per editing session, not per autosave pause |
| `POLL_MS` / `POLL_MAX` | `memory-panel.tsx` | 3 s / 40 | the cron runs every minute; two minutes of polling then "sort again" |
| Reprocess `limit` | payload default | 50 per job | self-enqueues while readings remain |

ALGORITHMS.md §1 rewritten to match.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/entities/__tests__/resolve.test.ts` (13) | the three `fixtures/history/` arcs walked through an in-memory store executing `planApply()`: "my girlfriend" then "Alex" → one entity, renamed; bare "she" dropped; "my ex" tentative toward the partner; the user's relink yields `partner 2026-01-01→2026-05-19, ex_partner 2026-05-20→`; "the agency" / "my boss" / "Priya, my manager" collapse; two Alexes → ask (roles differ) while "Alex, my friend" → auto; "the old agency" tentative toward the agency; "Mum" → "my mum"; "Sami" tentative, "Jordan" new; "Leeds" auto after 370 days. Boundaries: weights sum to 1; exact-alias dominance and its kind/role exceptions; auto needs the margin; TENTATIVE band above and below; trigram floor on/off; ambiguity asks only when history changes; naming channel and its "already named" exception; successor channel; journey signal renormalised out / counted; reasons are sentences without numbers; pronouns never resolve |
| unit | `domain/entities/__tests__/entities.test.ts` (16) | normalisation, relation lexicon, compatibility/exclusivity, role change plans (close day-before, never before start, unrelated coexist, closed stays), merge/split plans, planApply for tentative/new, trigram mirror vs pg_trgm, `modelBorn()` refusals |
| unit | `domain/extraction/__tests__/extraction.test.ts` (8) | payload schema (defaults, strict, no probability, bounds), hashes, taxonomy mapping, `applyOverrides` for every chip kind, overrides surviving a changed payload, malformed overrides ignored |
| unit | `memory/__tests__/context.test.ts` (2) | prompt context admits `auto` + `user` only; the DB reader filters by the same list |
| unit (invariant) | `alias-merge-preserves-historical-roles.test.ts` (3, **unskipped**), `model-cannot-create-confirmed-fact.test.ts` (+1), `raw-text-never-overwritten.test.ts` (+`src/memory`), `opening-reading-makes-no-ai-call.test.tsx` (entry points + lazy edge), `deleting-reading-purges-derived.test.ts` (+5 tables, 0007 scan), `deletion-registry.test.ts` (+10), `journal filters` (+entity) | see below |
| integration | `memory/__tests__/extraction.integration.test.ts` (6) | versioned payload persisted after the reading exists, reading byte-identical, `ai_calls` row; fresh-skip, forced supersede without delete, notes edit → stale → re-extract; corrections survive re-extraction and a `reprocess_extractions` job (3 rows, one current), clearing an override; provider failure → failed row + `ExtractionRetry` + retry succeeds, invalid output terminal; no consent / flag off → no call, no rows, job succeeds quietly; descriptor → name collapse across readings, pronoun-only reading creates nothing, two Alexes → ask with both options, the answer pins (`user`, confirmed, question closed, survives a forced re-extraction), "someone new" creates a confirmed entity; model-born theme links unconfirmed |
| integration (invariant) | `alias-merge-preserves-historical-roles.integration.test.ts` (3) | merge keeps `partner 2024-01-01→2024-12-31` and `partner 2026-01-01→` as two rows, moves aliases and mentions, pins the target, records the receipt; undo restores aliases, roles, mention ids and the target's flags exactly and refuses twice; a role row cannot be rewritten or reopened (`23514`), a successor adds + closes; split moves chosen mentions (`user`) with their aliases to a confirmed entity, refuses moving every mention |
| integration | `deleting-reading-purges-derived.integration.test.ts` (extended) | a reading with an extraction, an override, themes, mentions and a prediction purges to zero in every registry table; the receipt names all ten counts; entities survive; the kept reading keeps its extraction |
| integration | `export.integration.test.ts` (extended) | `export/1.1.0` archive validates; extraction with versions, the override, user-confirmed theme, curated theme rows referenced, entity with alias, mention linking reading↔entity, `POSSIBILITY` predictions without probability, new link kinds |
| rls | `db/__tests__/memory.rls.test.ts` (12) | isolation on all ten tables (B and anon see nothing, B cannot spoof, update or delete A's rows), child rows refused on another user's entity or reading, `extractions` job-written (owner reads/deletes, nobody inserts/updates), curated themes readable and unwritable, `predictions.fact_status` check, merge/undo/split refuse another user's entities (`P0002`) and anon (`42501`), `search_readings(entity_id)` returns only the caller's rows |
| e2e | `e2e/memory.spec.ts` (2 × 2) | **390 px:** save a reading → panel waits or is ready (a parallel worker's cron batch may claim the job first — as production's cron would) → `runJobs()` → chips: "suggested" in text, Decision, Anxiety, Lisbon, "my girlfriend"; the note textarea unchanged; keyboard to "why?" → reasons; axe clean → dismiss Anxiety (live region "Anxiety dismissed."), keep Decision (becomes "you"), dismiss Lisbon → reload: all persisted; `readings.question/user_notes` byte-identical in the DB; exactly one `extract_reading_metadata` call → second reading "Alex, my girlfriend" → the same entity, renamed ("Alex · as “my girlfriend”") → People & places lists one Alex, a Partner, axe clean → picker "Someone new" → two Alexes → open the confirmed one → Merge dialog names both → target page shows the undo notice and both readings → one Alex → Undo → two → journal *Mentions* filter → `entity=` in the URL, count. **No consent:** "Not sorted." and zero `ai_calls`, zero entities |

Invariant tests unskipped this phase:
- [x] `alias-merge-preserves-historical-roles.test.ts` — the merge plan keeps every role row that
      is not an exact (role, valid_from, valid_to) duplicate; a role change is add-and-close and
      leaves its input untouched; the migration has the `entity_roles_immutable` trigger checking
      `role` and `valid_from`, the merge function's only role update is `SET entity_id`, and the
      query layer's only role update is `valid_to`. **Integration:** as in the table above.
- [x] `model-cannot-create-confirmed-fact.test.ts` — extended: `user_confirmed` defaults false on
      entities and theme links, `predictions.fact_status` defaults to and is checked as
      `POSSIBILITY` with no probability column (schema + migration), `modelBorn()` refuses
      confirmed / user-sourced / user-resolved rows, the resolver's decisions can only be written
      as `auto` or `tentative`, every model-side insert in the materialiser is gated (the one
      `resolution: 'user'` write carries the user's own relink).
- [x] `raw-text-never-overwritten.test.ts` — `src/memory` is on the derived side: no write to
      `readings` / `reading_cards`, no reference to `user_notes` / `question` in the materialiser.
- [x] `opening-reading-makes-no-ai-call.test.tsx` — the memory route, query layer, corrections
      and materialiser are on the graph and AI-free; the extraction run and handler are not
      reachable (only the registry's lazy `import()` edge, which the scan skips and asserts).
- [x] `deleting-reading-purges-derived` — five new job targets, `predictions` in the FK scan.

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  44 passed | 4 skipped (48)
      Tests  306 passed | 4 skipped (310)          (unit, 6.9 s)
 Test Files  15 passed (15)
      Tests  94 passed (94)                        (integration, 35 s)

$ pnpm test:rls
 Test Files  9 passed (9)
      Tests  36 passed (36)

$ pnpm build && pnpm check:client-bundle && pnpm check:prompt-versions
 ✓ Compiled successfully in 5.7s
├ ƒ /api/readings/[id]/memory 169 B · /profile/entities 534 B (106 kB) · /profile/entities/[id] 6.5 kB (135 kB)
check-client-bundle: ok (67 files scanned)
check-prompt-versions: ok

$ pnpm test:e2e            (mobile 390×844 + desktop, fresh `next start`)
  114 passed (2.5m)        — the run before it (stale server from an older build) showed 5
                             unrelated failures; killing the server fixed all of them

$ pnpm db:migrate  →  migrations applied
$ curl localhost:3100/api/health  →  {"status":"ok","db":true,"migration":{"current":true,"expected":"0007_structured_memory",…}}
$ pnpm db:seed     →  … 5 spreads · 30 themes
$ pnpm demo:seed   →  22 readings extracted, 8 entities found, corrections applied   (3.6 s wall clock)
$ pnpm eval --dry  →  extract_reading_metadata: entity recall 100% · precision 88% over 7 expected mentions
$ pnpm jobs:reprocess --to-schema=extraction/1.0.0  →  {"event":"jobs.reprocess",…,"claimed":1,"succeeded":1}
```

Registry gate (`scripts/check-deletion-registry.ts`) fired for all ten new tables before they
were registered:
```
Deletion registry is missing user-owned table(s): entities, entity_aliases, entity_mentions, entity_merges, entity_roles, extractions, metadata_overrides, object_themes, predictions, themes
```

Traced scores on the fixture arcs (the resolver's own output, `SimStore`):
```
relationship-arc  day 9  my girlfriend → auto 0.987 · day 20 Alex → auto 0.923 (renamed) · day 35 she → drop
                  day 130 my ex → tentative 0.702 · day 150 Alex → auto 0.868
career-arc        day 14 Priya (my manager) → auto 0.919 (renamed from "my boss") · day 45 Alex (colleague) → tentative 0.838
                  day 60 Alex → ask 0.868 (friend vs colleague) · day 61 Alex (friend) → auto 0.994 · day 100 the old agency → tentative 0.813
relocation-arc    day 30 Mum → auto 0.975 (my mum) · day 40 Sami → tentative 0.745 (Sam) · day 45 Jordan → new (best 0.45) · day 400 Leeds → auto
```

Demo database after `pnpm demo:seed` (psql):
```
 Maya   person  active  confirmed  aliases: my girlfriend, M., Maya, my ex   roles: partner 2026-04-11→2026-08-23; ex_partner 2026-08-24→now   mentions 7
 Leeds  place · the agency organization (employer) · my mum person (parent) · Sam · J. · the new team
 M.     merged into Maya · entity_merges: 1 live · metadata_overrides: entities/ex → linked Maya
```

| Metric | Target | Measured |
|---|---|---|
| Entity recall / precision (mock, 4 fixtures, 7 mentions) | record baseline | 100 % / 88 % |
| Wrong-but-confident entity links in 12 seeded readings read by hand | 0 | 0 of 9 mentions (all correct; "my ex" arrived tentative and was confirmed by the seeded relink) |
| Model calls per save (extraction) | 1, never in the request path | 1 (`ai_calls`, e2e), run by the cron batch |
| Model calls per correction / per entities page / per reading reopen | 0 | 0 (import-graph scan + e2e ledger) |
| Extraction run end to end (mock, incl. materialise) | — | ~50–100 ms per reading; 22 demo readings in ~1.5 s |
| Journal scroll, 1000 entries (regression check) | 60 fps | 466 frames · p50 16.7 ms · p95 16.7 ms · 2 long (unchanged from 05) |
| Unit / integration / RLS / e2e | fast | 6.9 s / 35 s / 9 s / 2.5 min |

Manual checks actually performed:
- [x] **Read the extracted metadata for 12 seeded readings** (query in §8 above): every one of
      the 9 mentions is a real person or place with the right kind; themes are plausible for the
      text; the user's own life area is kept when set; the mock's possibility phrasing is stilted
      ("The new routine stick may come to pass") — a mock artefact, the prompt asks for a
      sentence. No threshold was raised: nothing arrived confident and wrong.
- [x] **390 px screenshots, light + dark:** the Connections panel (chips, "you" chip for the
      relink, ask absent because answered), People & places list (four people, two organisations,
      Leeds), Maya's page (undo notice, partner range closed the day before ex-partner, four
      aliases, seven mentions with reading links and "why"), the journal filter panel with
      *Mentions*, Profile with the new row and the widened delete-artifacts copy.
- [x] **Keyboard:** Tab to "why?" → Enter opens the popover, Escape closes (e2e); every chip
      control is a native button; the picker, life-area select and add-theme field are labelled;
      the merge dialog is the Radix alert dialog (focus trap, Escape).
- [x] **Screen reader:** every panel outcome is announced in a polite live region ("Anxiety
      dismissed.", "Linked.", "Suggestions ready."); entity page controls announce "Renamed.",
      "Merge undone."; inference is always a word in the chip ("suggested" / "possibly" / "you"),
      never colour alone.
- [x] **Registry completeness gate** fired for the ten tables (above).
- [x] **`pnpm jobs:reprocess`** against the demo data: nothing to do at the current schema; a
      target other than the deployed schema is refused (would never converge).

## 9. UX notes

States of the Connections panel: **not sorted** (AI off — plain copy, link to Profile),
**looking** (polite status while the queued job runs; polls the memory route every 3 s for two
minutes), **ready** (five groups of chips), **stale** (an earlier version of the reading was
read; refreshes after the next pass), **failed** ("Couldn’t sort this reading. Your words are
unchanged" + *Try again*, which only queues and says "Runs within a minute or so"), and an
**open question** rendered inline as a small group with one button per candidate. Every
inferred value: the word "suggested" (or "possibly" for tentative matches) in text, "why?" with
the resolver's actual reasons, a one-tap dismiss, and a correction that fits the value (a
select, a picker, an edit field) — never a modal. Corrections become solid "you" chips with an
undo. Entities pages: the empty state teaches ("As you write readings, the people … will collect
here — matched by the names you use, never by guesswork about who you mean"); the merge
confirmation names what moves and that it can be undone; the remove confirmation counts the
mentions and says readings are untouched.

Design system extended: `InferredChip` (`label`, `onKeep`, `correctLabel`), `MemoryPanel`, the
`UserChip` treatment, the entities list and detail controls; DESIGN_SYSTEM.md updated. The
`MemoryPanel` and entity controls are islands bound to actions and are **not** in the `/dev/ui`
gallery (the underlying `InferredChip` is).

Rough edges left deliberately: chips wrap onto several lines at 390 px when a label is long
("Alex · as “my girlfriend”"); the possibility chip's long text renders as a wrapped chip rather
than a card; the entity picker is a native `<select>` (fast to build, keyboard-friendly, plain);
"ended today" is the only way to close a role from the page (a date picker is a small follow-up);
the demo mock's possibility phrasing is clumsy; the fixed bottom nav shows mid-page in full-page
screenshots (capture artefact).

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Real-model `pnpm eval` for extraction + human read of the four baselines, then flip `FLAG_AI_EXTRACTION` | No `ANTHROPIC_API_KEY` in any environment (same as 04) | owner (any time) |
| Embedding channel for entity candidates (`embeddingSimilarity`, ALGORITHMS §1 step 3) | Needs an entity context vector and an embed call per mention; retrieval brings the embedding infrastructure. The scoring hook and threshold exist. | 09 |
| Journey overlap signal | No journeys yet; renormalised out until they exist (documented) | 07 |
| Re-scoring dependent `links` on merge / split | `links` land in 08; `apply_entity_merge` re-points overrides and open questions, which are the only dependents today | 08 |
| Prediction retraction when a reprocess no longer produces a possibility | Ids kept stable for outcomes; the semantics of "the model no longer says this" belong with outcomes | 08 |
| `extract_event_metadata` on the same schema family | Life events are 08 | 08 |
| Summaries in delete-AI-artifacts and the export | Tables land in 10 | 10 |
| A date picker to close a role on a chosen day; editing an entity's kind | Small; "ended today" and a successor role cover the common case | when asked |
| `MemoryPanel` / entity controls in `/dev/ui` | Islands bound to server actions; the chip primitive is in the gallery | 12 (gallery pass) |
| Coalescing the notes-edit extraction beyond the 60 s dedupe window | One extraction per editing session is the honest cost; revisit if `ai_calls` shows churn | 11 (budgets) |

## 11. Known issues and risks

- **The mock extractor is scaffolding.** It is rule-based and English-only; it exists so the
  whole path is exercised without a key. The product's precision depends on the real prompt,
  which no one has run yet. If real-model precision is poor, raise `TENTATIVE` toward the auto
  band rather than shipping confident errors (§4.4) — the resolver leans tentative already.
- **Materialise-then-complete** means a reader may briefly see mentions/themes for an extraction
  that is still `pending` (the panel shows "looking" until complete, so nothing renders early);
  a materialise failure marks the row `failed / materialize_error` and the job retries.
- **Concurrent extractions of one reading** (two workers, two jobs) are prevented by the enqueue
  dedupe only while the first is `queued`; a job already `running` when a second enqueue happens
  produces a second run. Both complete correctly (supersede is ordered), but the model is called
  twice. A per-reading advisory lock is a Phase 12 hardening item.
- **Stale `next start` servers** produced five spurious e2e failures in one run (chunk mismatch
  after rebuilds); `pnpm test:e2e` reuses an existing server locally. Kill port 3100 after
  rebuilding.
- The Phase 03 reading test's `/suggests|may|one way/` check on a random card's reference text
  was loosened to `/suggest|may|one way|point/` — one RWS meaning says "tends to suggest".
- The journal scroll test now has its own 90 s budget: loading 34 pages plus the ~8 s measured
  scroll pass 30 s under 8 workers; the assertion (frame timing) is unchanged.
- `pnpm demo:seed` wipes and regenerates every memory row for the demo users (it must — readings
  are regenerated); user-flag overrides for `demo-ana` persist.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm eval --dry
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` → Journal → open *How are things
   really with M.?* (Aug 24) → *Connections*: Life area, Themes, People and places (Maya four
   ways, one "you" chip for "my ex"), "why?" on any chip. Dismiss a theme, reload: still gone;
   tap × on the "you" chip: the suggestion returns.
2. Profile → *People & places*: Maya (confirmed, Ex-partner, 4 names, 3 readings), the agency,
   Leeds… Open Maya: the undo-merge notice, roles over time (partner closed the day before
   ex-partner), seven mentions with links. Undo the merge → *M.* is back in the list; merge it
   again from M.'s page.
3. Start a reading with "Should I take the job in Lisbon with my girlfriend?" and a note → save
   → Connections says it is looking → `pnpm jobs:run` (the cron) → chips appear within 3 s.
   Journal → Filters → *Mentions* → pick Maya.
4. Profile → *Delete AI artifacts*: the dialog counts suggested themes, mentions and unconfirmed
   people; confirm → Maya stays (confirmed), the corrections stay, the readings are untouched.
5. `pnpm jobs:reprocess --to-schema=extraction/1.0.0` → nothing to do; bump the schema version
   in `version.ts` and run again → every consenting reading gets a new current extraction and
   the corrections still show.

## 13. Notes for the next phase

- **Entities for prompts:** `entityContextForObjects(userId, [{type, id}])`
  (`src/memory/context.server.ts`) is the only sanctioned source — `auto` and `user` mentions,
  active entities, with `mentionedAs[]`. Never read `entity_mentions` directly for a prompt.
- **Journey signals:** `resolveMention(m, candidates, { journeysExist: true, journeyIds })` and
  `CandidateEntity.journeyIds` are wired; `loadCandidates()` in `memory/candidates.ts` needs to
  fill `journeyIds` and `changesHistory()` already compares them. Setting `journeysExist` turns
  the 0.15 weight back on — check the fixture arcs still pass with journeys present.
- **Journey candidates:** every extraction payload carries `journey_candidates[] {title,
  confidence}` (`effective.journeyCandidates`); resolved entities per reading are the
  `entity_overlap` input for affinity (Jaccard over `auto` + `user` mentions only — ALGORITHMS §2).
- **Themes per reading:** `object_themes` joined to `themes` (slug, label, category, weight,
  user_confirmed) — `getReadingMemory().themes` or a direct read; `theme_overlap` for affinity
  should use slugs.
- **Journal filter pattern** (worked for `entity`): a key in `journalFiltersSchema` + `URL_KEYS`,
  the parameter in `searchJournal`'s `p`, an `EXISTS` in `search_readings` (new migration
  replacing the function — keep `WHERE r.deleted_at IS NULL`, the invariant scans 0006 and 0007;
  add 0008 to that scan), a select in `filters.tsx` gated on data existing.
- **Materialise is the hook for derived writes:** `materializeReading(readingId)` is called after
  extraction, reprocess and every correction; a journey-assignment step belongs after
  `materializeEntities` (it needs the resolved mentions) and must be idempotent and model-free
  (naming via `propose_journey` is a separate, gated job).
- **Deletion registry:** `journey` root is empty; `journey_members` keyed by `(object_type,
  object_id)` needs a `via: 'job'` entry + counter + remover in `purge.ts` (see the four
  polymorphic tables added this phase for the pattern).
- **Export:** `EXPORT_SCHEMA_VERSION` is `export/1.1.0`; adding journey files bumps to 1.2.0.
- **Lazy job handlers:** an AI-backed handler goes in `handlers/payloads.ts` (schema) + a lazy
  `load` in `handlers/index.ts`; `opening-reading-makes-no-ai-call` lists the static handlers
  it follows — add non-AI handlers there, never AI ones.
- **Demo seed order:** `seedMemory` runs last and wipes memory rows for the demo users; a journey
  seeder must run after it and derive from its entities (`Maya`, `the agency`, `Leeds`).
- These notes were added to the Phase 07 file.
