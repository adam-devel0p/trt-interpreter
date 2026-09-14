# Test Strategy

Five suites, five different jobs (§20). A phase is done when all five pass and the phase's manual
checks were actually performed.

| Suite | Command | Runs where | Covers |
|---|---|---|---|
| Unit | `pnpm test` | CI, fast | `src/domain/` pure logic: scoring, resolution, thresholds, fact-status gate, RNG, retrieval-document builder, ranking / bounding / citation verification |
| Integration | `pnpm test` (tagged) | CI with local Supabase | API handlers, transactions, job handlers, queries, cascade deletes |
| Authorization / RLS | `pnpm test:rls` | CI with local Supabase | Every user-owned table: user B cannot select/insert/update/delete user A's rows; anon cannot read anything user-owned; reference tables are readable |
| E2E | `pnpm test:e2e` | CI (Playwright, seeded DB) | The real flows a user performs, plus axe accessibility scans and 390px viewport |
| Prompt evals | `pnpm eval` | Manual / nightly, **never in CI** | Real-model output quality, deck purity, register, citation integrity, refusal behaviour |

## Principles

- **`src/domain/` is where the hard logic lives and where coverage is highest.** If an algorithm needs
  a database or a model to be tested, it is in the wrong layer.
- **The mock provider is deterministic and fault-injecting.** `mock.failWith('timeout')`,
  `'invalid_json'`, `'refusal'`, `'429'`. Every AI failure path in [AI_LAYER.md](AI_LAYER.md#failure-handling-13-ai-resilience)
  has a test that uses it.
- **RLS is tested against the real database with real JWTs**, not mocked. Two fixture users, A and B,
  created per test file via `createRlsFixture()` in `src/__tests__/rls/harness.ts`;
  `expectRlsIsolation(fixture, table, rowFactory, { mutableColumn, mutatedValue, ownerColumn?,
  preexisting? })` covers select/insert/update/delete + anon (`ownerColumn: 'id'` for `profiles`;
  `preexisting: true` for trigger-created rows, which also asserts the owner *cannot* delete),
  `expectReadOwnOnly()` covers read-own/service-role-write tables (`user_flags`),
  `expectNoUserAccess()` covers service-role-only tables (`jobs`), and `expectPublicReadOnly()`
  covers global reference tables (`decks`, `cards`, …: anon **can** read, nobody but the service
  role writes). Tables that mix public and owned rows (`spreads`) pass `hasPublicRows: true` to the
  isolation harness so the anon check becomes "cannot see A's row".
  File naming selects the suite: `*.test.ts` unit · `*.integration.test.ts` integration ·
  `*.rls.test.ts` RLS.
- **Invariant tests** — a dedicated `src/__tests__/invariants/` directory asserts the §21 list
  directly, one test file per invariant, named after it. These are the tests that must never be
  weakened to make a feature pass:
  - `model-cannot-create-confirmed-fact.test.ts` (live since Phase 04: `modelWrite()` refuses user-only statuses; every interpretation write the query layer sends carries `TAROT_INTERPRETATION`; the check constraint is declared in the Drizzle schema and the migration, and exercised against Postgres in the interpretation integration suite. Extended in Phase 06: entities, theme links, mentions and predictions are born unconfirmed — schema defaults, the `POSSIBILITY` check, `modelBorn()` refusing confirmed/user rows, the resolver never yielding a `user` resolution, every model-side insert in the materialiser gated)
  - `thoth-never-substitutes-rws.test.tsx` (live since Phase 02: seed data, a source scan of every render path for archetype references, and the rendered `Card` markup)
  - `opening-reading-makes-no-ai-call.test.tsx` (live since Phase 03: a transitive import-graph scan proves nothing under the reading routes, queries or detail component reaches `src/ai/`; with every AI entry point stubbed to throw, `getReading` against a PostgREST-shaped fake touches only `readings` and `ReadingDetail` renders both decks' readings complete from stored data)
  - `reading-survives-ai-failure.test.ts` (live since Phase 04: the interpretation service against an in-memory store and the fault-injecting mock through invalid output ×2, timeout → downgrade → timeout, 429 ×3, 5xx ×3, refusal, deck purity ×2, budget denied, circuit open, no consent and cancellation — the reading is byte-identical after each, the row records the class; repeated against Postgres in `src/interpretation/__tests__/interpretation.integration.test.ts`)
  - `card-overlap-alone-never-correlates.test.ts` (live since Phase 08: identical spreads on any two dates are never eligible; a shared card plus one weak non-card signal is not enough, two are; the card weight is the smallest and the guard needs two non-card signals, one temporal; the runtime stores only eligible pairs)
  - `rejected-link-not-resuggested.test.ts` (live since Phase 08: an identical re-run after a rejection yields the same fingerprint and is not re-surfaced, a day of drift neither; new evidence needs +0.15 or a user-confirmed overlap that did not exist before, and returns it once; the query layer records the rejection point and the run consults `shouldResurface` and never deletes a rejected row; the database half — reject, re-run unchanged → nothing, hand-link the mention → back once, reject again → gone for good — is `src/correlation/__tests__/correlation.integration.test.ts`)
  - `summary-never-sole-evidence.test.ts` (live since Phase 08: a bundle whose only evidence came from an interpretation or a summary produces no link even inside the stated window; generated evidence adds nothing to a bundle that has the user's words — identical score, signals and fingerprint; the feature loader reads only extractions of the user's words and marks them `user_text`, and the engine filters regardless. Phase 10: `validateSources` rejects a period summary's source set made only of summaries/interpretations and the empty set (the `period_summaries_sources_check` constraint is in the schema and migration and exercised against Postgres in the summaries integration suite); the generator validates before storing and builds evidence from readings and events only (structural); a `confirmed_fact` claim without confirmed evidence is dropped; an Ask claim citing only covering summaries is dropped)
  - `deleting-reading-purges-derived.test.ts` (live since Phase 05; Phase 09 adds `retrieval_documents` (job + trigger), `embeddings` (cascade) and the `asks` citation scrub to both roots, and the integration half embeds the reading, stores an ask citing it and the survivor, and asserts the vector is gone and the ask keeps only the survivor's citation; the purge job has a counter and remover for every registry target, every table with a `reading_id` FK is registered (a `set null` FK is a cleared pointer, not a dependent — Phase 08's `life_events.reading_id`), delete is soft delete + `purge_deleted`, every read path filters `deleted_at`; Phase 08 adds the `life_event` root on the same terms; `…integration.test.ts` soft-deletes a reading carrying every derived artifact — since 08 an outcome and a user link too — runs the job, asserts zero rows in every registry table, the event surviving with its pointer cleared, and a receipt with the counts)
  - `archive-readable-without-subscription.test.ts` (live since Phase 05: no journal, detail, search, export or delete path references the plan, a subscription, a budget or a paywall; `…integration.test.ts` sets `plan = 'free'`, withdraws consent and proves list, search, detail with stored interpretation, history and export still work — Phase 11 must extend it to exhausted limits)
  - `no-journal-content-in-logs.test.ts`
  - `raw-text-never-overwritten.test.ts` (live since Phase 05: no derived-side module writes `readings` or `reading_cards`, every `modelWrite()` payload is free of user-text columns, the `readings_keep_text` trigger and the revisions policies are in the migration; `…integration.test.ts`: three note edits keep three versions + current, a question edit is kept and bumps `metadata_version`, a raw service-role update still leaves history, derived artifacts leave the words byte-identical, revisions cannot be forged or edited)
  - `alias-merge-preserves-historical-roles.test.ts` (live since Phase 06: the merge plan keeps every role row that is not an exact duplicate, a role change is add-and-close, the `entity_roles_immutable` trigger and the merge function's `UPDATE entity_roles SET entity_id` are in the migration; `…integration.test.ts` merges two partners with different ranges, undoes it exactly, refuses a rewritten role at the database, and splits mentions to a new confirmed entity)
- **The provider spy in e2e is `ai_calls`.** Every model call lands there (with the mock provider
  too), so "reopening makes no new call" is asserted by counting rows before and after, and
  "regenerate makes exactly one" likewise (`e2e/interpretation.spec.ts`). Scope the count to
  the test's `user_id` — other specs run in parallel and do call the model.
- **Phase 05 fixtures.** `src/__tests__/fixtures/journal-db.ts` builds readings through the real
  `create_reading()`, stored interpretations through the write gate, flags and question asks
  through their query functions (`makeReading`, `storeInterpretation`, `attachDerived`);
  `e2e/_helpers.ts` gained `seedReadings(userId, specs)` (service-role inserts, same rows) and
  `signInAsDemo()`. The journal performance suite
  (`src/db/queries/__tests__/journal-perf.integration.test.ts`) seeds 1000 readings with the
  demo generator and asserts p95 < 300 ms per query; the scroll check in `e2e/journal.spec.ts`
  signs in as `demo-cleo` (needs `pnpm demo:seed`) and records frame times as an annotation.
- **Phase 08 fixtures.** `attachDerived(user, reading, { event: true })` adds a life event
  logged about the reading (a user-confirmed link) and an outcome pointing at it;
  `enableCorrelation(userId)` turns the `correlation_suggestions` flag on like a rollout;
  `e2e/_helpers.ts` gained the `correlation` option on `createReadyUser` and `revisitAt` on
  `seedReadings`. The mock event extractor (`src/ai/tasks/extract_event_metadata/mock.ts`)
  layers event verbs ("accepted", "talked", "moved") and a type / importance over the
  reading rules, so the whole loop runs without a model.
- **Phase 06 fixtures.** `fixtures/history/*.json` are the hand-authored arcs (relationship,
  career, relocation) the resolver is walked through by `src/domain/entities/__tests__/resolve.test.ts`
  with an in-memory store (`simulate.ts`) that executes the same `planApply()` mutations as the
  database materialiser; `src/__tests__/fixtures/memory-db.ts` turns the `ai_extraction` flag on
  per test user; `attachDerived(user, reading, { memory: true })` runs a real extraction (mock
  provider) with one override; `e2e/_helpers.ts` gained `createReadyUser(tag, { extraction })`
  and `runJobs()` (one cron batch through `/api/jobs/run`). Extraction evals live in
  `src/ai/tasks/extract_reading_metadata/fixtures/` and score entity recall/precision and theme
  sanity (`pnpm eval --dry` for the mock baseline).
- **Phase 09 fixtures.** `createReadyUser(tag, { ask: true })` turns `ask_my_history` on;
  `enqueueEmbeddings(userId, objects)` queues the `embed_object` jobs a save would have;
  `seedJourney(userId, title, readingIds)` builds a user journey for the scoped ask. The
  retrieval integration suite (`src/retrieval/__tests__/retrieval.integration.test.ts`) uses a
  spy embedder to assert the outbound payload equals the stored document text, the mock
  provider's `respondWith()` to force a fabricated citation and an uncited answer, and a
  1000-reading user (direct inserts) for the bound and the timings. The RLS suite calls
  `search_history()` as user B with A's ids in the parameters. `pnpm eval --dry` runs the eight
  benchmark asks against the demo journal (`pnpm demo:seed` first) and fails on any invented
  card or date.
- **Phase 10 fixtures.** `enableSummaries(userId)` turns `period_summaries` on like a rollout;
  `src/summaries/__tests__/summaries.integration.test.ts` drives the generator against
  Postgres with the mock provider (floor → nothing; above → a cited, sourced row with a
  vector; unchanged → no call; dismissed → remembered; `respondWith()` fabricated labels →
  not stored; a source purged → scrubbed + stale by job, the last one → the row gone by
  trigger; Home's one-per-day resurfacing and the switches; covering summaries for dropped
  Ask entries). `src/db/__tests__/summaries.rls.test.ts` proves B cannot read A's summaries
  and a session can only dismiss. `e2e/retrospective.spec.ts` runs on the demo journal and a
  fresh user; `pnpm eval --dry` runs the summariser and narrator over the demo's recent
  periods and journeys and fails on any unsupported claim, unknown label, unsupported
  "confirmed fact", invented card or register slip.
- **Tests that need the seed decks or the mock provider live outside `src/domain/` and `src/ai/`**
  (the layering lint applies to test files too): `src/interpretation/__tests__/` holds the
  purity, prompt and repeat-rule tests.
- **E2E timing is measured, not assumed.** `e2e/reading.spec.ts` records `physical-3-card-ms`
  (scripted) and `physical-3-card-human-paced-ms` (120 ms per keystroke, 700 ms think time per tap)
  as test annotations and fails above 60 s. `expectNoSeriousA11y()` waits 300 ms for colour
  transitions before auditing, otherwise axe samples a blended colour mid-transition.
- **E2E users are real.** Specs sign up through the UI, or call `createReadyUser()` (admin API,
  onboarding pre-completed) from `e2e/_helpers.ts`; email links are read from Mailpit
  (`latestEmailLink()`), so magic link and password reset are exercised end to end. Playwright
  loads `.env.local` for the keys. Per-IP auth rate limits are skipped for loopback, so repeated
  local runs never trip them; per-email limits still apply (use `freshEmail()`).
- **Accessibility is tested, not reviewed.** Playwright + `@axe-core/playwright` on every primary
  screen; zero serious/critical violations is a gate.
- **Demo data is test infrastructure.** `pnpm demo:seed` must produce a database in which every
  longitudinal screen has something meaningful to show. E2E specs for phases 07–12 run against it.

## Fixtures

- `src/ai/tasks/<task>/fixtures/*.json` — eval fixtures (readings by deck and spread, safety
  questions); `__baselines__/` holds the last run's outputs with a `human_review` block.
  Deck-purity tests use the real seed modules in `src/db/seed/decks/` directly; they are pure
  TypeScript and need no database. `src/__tests__/fixtures/reading.ts` builds a `ReadingView`
  (and a stored interpretation) from the seeds for render and service tests; `memoryStore.ts` is
  the in-memory `InterpretationStore`. `fixtures/decks/` stays empty — recorded provider
  responses were not needed, the mock's fixture *functions* answer for any reading.
- `fixtures/history/` — hand-authored user histories (a relationship arc, a career arc, a relocation
  arc) with expected entity resolutions, journey clusters and correlation verdicts. These are the
  ground truth for §8 behaviour and are extended as thresholds are tuned. Phase 08:
  `correlation/labeled-pairs.json` — 18 reading ↔ event pairs with a human `related` label,
  scored by `src/domain/correlation/__tests__/score.test.ts` (precision must be 1.0 on the set;
  the one allowed miss is named) and by the model-free `correlate` section of `pnpm eval`,
  which prints precision and recall in every mode.
- `fixtures/ai/` — recorded model responses per task/version for deterministic unit tests.

## CI gates

`lint` → `typecheck` → `unit+integration` → `rls` → `build` → `e2e`.
Plus: prompt/schema edits without a version bump fail; a user-owned table missing from the deletion
registry fails (`scripts/check-deletion-registry.ts` in `pnpm lint` **and**
`src/db/__tests__/deletion-registry.test.ts` — verified in Phase 05 by removing
`reading_note_revisions`: both fail, naming the table); a client bundle containing a provider key
pattern fails.
