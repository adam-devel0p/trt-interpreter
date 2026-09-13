# Test Strategy

Five suites, five different jobs (§20). A phase is done when all five pass and the phase's manual
checks were actually performed.

| Suite | Command | Runs where | Covers |
|---|---|---|---|
| Unit | `pnpm test` | CI, fast | `src/domain/` pure logic: scoring, resolution, thresholds, fact-status gate, RNG, retrieval-document builder |
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
  - `card-overlap-alone-never-correlates.test.ts`
  - `rejected-link-not-resuggested.test.ts`
  - `summary-never-sole-evidence.test.ts`
  - `deleting-reading-purges-derived.test.ts` (live since Phase 05: the purge job has a counter and remover for every registry target, every table with a `reading_id` FK is registered, delete is soft delete + `purge_deleted`, every read path filters `deleted_at`; `…integration.test.ts` soft-deletes a reading carrying every derived artifact, runs the job, asserts zero rows in every registry table and a receipt with the counts)
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
- **Phase 06 fixtures.** `fixtures/history/*.json` are the hand-authored arcs (relationship,
  career, relocation) the resolver is walked through by `src/domain/entities/__tests__/resolve.test.ts`
  with an in-memory store (`simulate.ts`) that executes the same `planApply()` mutations as the
  database materialiser; `src/__tests__/fixtures/memory-db.ts` turns the `ai_extraction` flag on
  per test user; `attachDerived(user, reading, { memory: true })` runs a real extraction (mock
  provider) with one override; `e2e/_helpers.ts` gained `createReadyUser(tag, { extraction })`
  and `runJobs()` (one cron batch through `/api/jobs/run`). Extraction evals live in
  `src/ai/tasks/extract_reading_metadata/fixtures/` and score entity recall/precision and theme
  sanity (`pnpm eval --dry` for the mock baseline).
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
  ground truth for §8 behaviour and are extended as thresholds are tuned.
- `fixtures/ai/` — recorded model responses per task/version for deterministic unit tests.

## CI gates

`lint` → `typecheck` → `unit+integration` → `rls` → `build` → `e2e`.
Plus: prompt/schema edits without a version bump fail; a user-owned table missing from the deletion
registry fails (`scripts/check-deletion-registry.ts` in `pnpm lint` **and**
`src/db/__tests__/deletion-registry.test.ts` — verified in Phase 05 by removing
`reading_note_revisions`: both fail, naming the table); a client bundle containing a provider key
pattern fails.
