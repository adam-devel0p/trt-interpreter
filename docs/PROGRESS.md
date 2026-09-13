# Progress Ledger

The first thing to read in any new session. Update it at the end of every phase.

**Current state:** Phase 07 complete — journeys form themselves from evidence. After a
reading's memory is materialised, a model-free step (`src/journeys/`, pure scoring in
`src/domain/journeys/`) files it into active journeys at affinity ≥ 0.70, asks "Part of *X*?"
inline at 0.50–0.70, and clusters what is still unfiled: ≥ 3 readings across ≥ 14 days sharing
a resolved entity or a theme pair become an `active` journey, weaker shapes one dismissible
`suggested` card (dismissal remembered for good). Deviations from the written formula, each
forced by the fixture arc and documented in ALGORITHMS §2: entity overlap is the overlap
coefficient against a majority *core*, theme overlap is directional, a suggestion floor of 0.25
exists, only active/dormant journeys gather by assignment, and the entity resolver's journey
signal is unavailable (not zero) when either side is in no journey. Naming is the consent- and
flag-gated `propose_journey` job (`journey_proposal/1.0.0`); a rename pins the title. The
Journey detail has all eight §6.5 sections from stored rows: honest header, interleaved
timeline built on a `TimelineEntry` union (events/outcomes slot in), evidence-backed theme
progression (`source_object_ids` non-empty by check), deck-native recurring symbols (Lust ≠
Strength, Disks ≠ Pentacles), open loops, placeholders, disabled Ask; management: accept,
dismiss, rename, close/reopen, merge with undo (`apply_journey_merge` / `undo_journey_merge`),
split, delete, add, keep, remove with undo. Reading detail shows memberships with confidence
treatment; Home shows the one suggestion; the journal filters by journey; purge, export
(`export/1.2.0`) and delete-AI-artifacts cover the three tables. Demo: a mixed-deck *Me and
Maya*, an RWS-only *The agency and ambition* with open loops and pending questions, three weak
suggestions — all produced by the real pipeline. Full gate green (118 e2e). Owner-side
deferrals: the comprehension check with an unfamiliar person, the real-model naming eval, then
`FLAG_JOURNEY_AUTOCREATE`.
**Next phase:** [Phase 08 — Events, outcomes, correlation](phases/phase-08-events-outcomes.md)

## Phase status

| # | Phase | Status | Report | Notes |
|---|---|---|---|---|
| 00 | [Foundations & rails](phases/phase-00-foundations.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-00-report.md) | 2026-09-12 · local Supabase on ports 55321–55329 |
| 01 | [Auth, profile, onboarding](phases/phase-01-auth-onboarding.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-01-report.md) | 2026-09-12 · Google OAuth needs owner credentials to finish end to end |
| 02 | [Deck reference: RWS + Thoth](phases/phase-02-deck-reference.md) | ✅ complete | [report](phases/completed/phase-02-report.md) | 2026-09-12 · Thoth text-only + no reversals by design; RWS art committed (27 MB) |
| 03 | [Reading loop (no AI)](phases/phase-03-reading-loop.md) | ✅ complete | [report](phases/completed/phase-03-report.md) | 2026-09-12 · Thoth reversals test done on RWS by design; PWA device check still open |
| 04 | [AI boundary + interpretation](phases/phase-04-ai-interpretation.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-04-report.md) | 2026-09-13 · real-model eval + human baseline review need provider keys (owner) |
| 05 | [Journal, search, export](phases/phase-05-journal-search.md) | ✅ complete | [report](phases/completed/phase-05-report.md) | 2026-09-13 · ← shippable journal; `removeUserStorage()` ready for 12's account job |
| 06 | [Structured memory](phases/phase-06-structured-memory.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-06-report.md) | 2026-09-13 · real-model extraction eval + flag default need provider keys (owner) |
| 07 | [Journeys](phases/phase-07-journeys.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-07-report.md) | 2026-09-13 · comprehension check + real-model naming eval are owner tasks |
| 08 | [Events, outcomes, correlation](phases/phase-08-events-outcomes.md) | ⬜ not started | — | |
| 09 | [Retrieval + Ask My History](phases/phase-09-retrieval-ask.md) | ⬜ not started | — | ← MVP complete; run §22 study |
| 10 | [Summaries + retrospectives](phases/phase-10-summaries-retrospectives.md) | ⬜ not started | — | |
| 11 | [Monetization + retention](phases/phase-11-monetization-retention.md) | ⬜ not started | — | |
| 12 | [Hardening + beta](phases/phase-12-hardening-beta.md) | ⬜ not started | — | |

Status values: ⬜ not started · 🟡 in progress · ✅ complete · ⚠️ complete with deferrals

## Invariant test ledger

Each must be unskipped by the phase shown and never weakened afterwards. See
[TESTING.md](TESTING.md#principles).

| Test | Unskipped in | Status |
|---|---|---|
| `opening-reading-makes-no-ai-call` | 03 | ✅ |
| `thoth-never-substitutes-rws` | 02 | ✅ |
| `model-cannot-create-confirmed-fact` | 04 | ✅ |
| `reading-survives-ai-failure` | 04 | ✅ |
| `raw-text-never-overwritten` | 05 | ✅ |
| `deleting-reading-purges-derived` | 05 | ✅ |
| `archive-readable-without-subscription` | 05 | ✅ (Phase 11 must extend it to exhausted limits) |
| `alias-merge-preserves-historical-roles` | 06 | ✅ |
| `card-overlap-alone-never-correlates` | 08 | ⬜ |
| `rejected-link-not-resuggested` | 08 | ⬜ |
| `summary-never-sole-evidence` | 08 | ⬜ |
| `no-journal-content-in-logs` | 11 | ⬜ |

## Open questions carried forward

Add anything a phase discovered but could not settle. Remove when resolved.

- Thoth artwork: shipping the typographic treatment only (see `docs/LICENSING.md`). Schema and
  renderer accept per-card art (`art_asset_path`, `art_strategy = 'original_commissioned'`) if
  licensed or commissioned art becomes available (§6.7 artwork rights).
- Thoth reversals: `supports_reversals = false` and null reversed meanings (deck reads by dignity).
  If Thoth readers who do use reversals ask for them, it is a data change plus authored text, not
  a schema change.
- Pricing numbers are placeholders until retention data exists (§14).
- Google OAuth credentials: not present in any environment yet. The flow is wired and tested up to
  the provider redirect; the owner must create a Google OAuth client and export
  `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET` (local) / set them on the hosted project.
- Local Supabase runs on ports 55321–55329 (another project owns 54xxx on the dev machine).
  `.env.example`/README/CI all use 55xxx; nothing depends on the defaults.
- **Provider keys**: none in any environment. `AI_PROVIDER=mock` everywhere; the Anthropic and
  OpenAI adapters are tested against fakes only. The owner sets `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`, `AI_PROVIDER=anthropic`, runs `pnpm eval`, reviews
  `src/ai/tasks/interpret_reading/fixtures/__baselines__/*.json` and iterates the prompt
  (`PROMPT_VERSION` bump) if the output reads generic.
- Occasional `PGRST303` right after sign-in in local e2e (JWT "issued in the future": Docker
  vs host clock skew, ~10 ms). Routes that must never block (repeat check) fail soft. Phase 05
  hit the same skew in the job queue (a fresh job "due in the future"): jobs now let the DB stamp
  `run_after`, and a named job is claimed regardless. Never compare a JS `Date` to DB `now()`.
- Every note autosave pause writes a `reading_note_revisions` row (invariant 4 taken
  literally). Coalescing is a one-line trigger change if history gets noisy. Extraction after a
  notes edit is deduped and delayed 60 s, so an editing session costs one model call.
- **Two extractions of one reading can overlap** if a second enqueue lands while the first job
  is already `running` (dedupe only sees `queued`). Both complete correctly; the model is called
  twice. A per-reading advisory lock is a Phase 12 hardening item.
- The mock extractor is English-only rule scaffolding; the real prompt has not been run. If
  real-model precision is poor, raise `TENTATIVE` toward the auto band (§4.4) — the resolver
  already leans tentative.
- **Journeys with the mock extractor are theme-starved.** The demo notes were enriched with the
  words the rule-based mock catches; with the real model theme overlap will be richer and the
  suggestion floor (`SUGGEST_MIN_AFFINITY` 0.25) may need raising — watch suggestions per week
  before flipping `FLAG_JOURNEY_AUTOCREATE`.
- Batch discovery (demo seed, reprocess) surfaces every weak cluster of a history at once; the UI
  offers one suggestion at a time. Incremental use surfaces them as they form.
- Existing memberships are never re-scored by later corrections (by design); the one-tap remove
  is the correction path. A "re-evaluate memberships" job is a possible Phase 12 item.
- The two soft-deleted demo rows stay soft-deleted: nothing enqueues the `purge_deleted` sweep
  (`{readingId: null}`) yet — a cron entry or `pnpm jobs:sweep` is a Phase 12 ops item.

## Deferred items backlog

Phases append here when they defer something, so nothing is lost between sessions.

| Item | Deferred in | Moved to | Reason |
|---|---|---|---|
| Install PWA on a physical phone, verify offline shell | 00 → 01 → 03 | 12 | No device in any session so far; manifest/SW verified by e2e only |
| Google OAuth end to end with real credentials | 01 | owner / 12 | No client ID/secret available; wired and tested to the provider redirect |
| Shared auth rate-limit store (in-memory today, per instance) | 01 | 12 | `RateLimitStore` interface ready; Supabase Auth limits sit behind it |
| ~~`profiles.default_deck_id` FK to `decks`~~ | 01 | 02 ✅ | done in `0003_deck_reference` |
| Purge `%@test.local` users created by e2e runs | 01 | 12 | Harmless locally; CI DB is ephemeral |
| ~~`ai_calls` write in `telemetry.ts`~~ | 00 | 04 ✅ | `DbTelemetry` writes every run |
| Real per-user budgets (`BudgetPolicy`) | 00 | 11 | `usage_counters` lands in 11; hook wired and tested |
| Sentry source-map upload | 00 | 12 | Scrubbing proven without it |
| ~~Live deck switch inside a flow (no navigation)~~ | 02 | 03 ✅ | Deck step switches accent and naming in place |
| `fixtures/decks/` recorded fixtures | 02 → 04 | 12 (optional) | The mock's fixture *functions* answer for any reading; record real responses from the first eval run only if regression on specific outputs is wanted |
| ~~Change deck or spread of a saved reading~~ | 03 | 05 ✅ | `replace_reading_cards(…, p_spread_id, p_deck_id, p_uses_reversals)`; a deck change clears the cards with an honest notice |
| ~~Soft delete (`deleted_at`) for readings~~ | 03 | 05 ✅ | soft delete + `purge_deleted` job + receipts |
| Server-side card search RPC / Thoth `strength` ranking | 03 | — | In the Thoth picker, `strength` ranks Nine of Wands (titled *Strength*) above Lust (alias); correct per Phase 02 ranking, noted for UX review |
| Real-model `pnpm eval`, human baseline review, 5 real interpretations read, Thoth zero-RWS against the real model, kill-the-key mid-flow, breaker/timeout against the real provider | 04 | owner (any time) | No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this session; everything is wired and tested against the mock and a fake SDK client |
| Region-aware safety resources | 04 | 11/12 | No region known (`profiles.locale = 'en'`); international + US/UK lines shown |
| ~~Purge `safety_flags` with the reading~~ | 04 | 05 ✅ | explicit remover in `src/privacy/purge.ts`, receipt counts it |
| ~~Interpretations in journal list / export~~ | 04 | 05 ✅ | list preview = current `synthesis`; export carries every generation |
| ~~Entity / journey filters in the journal~~ | 05 | 06 ✅ / 07 ✅ | `entity=` in 06, `journey=` in 07 (`EXISTS` on `journey_members`, state ≠ removed) |
| ~~Extractions~~ + summaries in "Delete AI artifacts" and in the export | 05 | 06 ✅ / 10 | extractions, themes, mentions, predictions, entities in both (export/1.1.0); summaries in 10 |
| Real-model `pnpm eval` for `extract_reading_metadata`, human read of the four baselines, then `FLAG_AI_EXTRACTION=true` | 06 | owner (any time) | no provider key; mock baseline recorded (recall 100 %, precision 88 %) |
| Embedding channel for entity candidates (`embeddingSimilarity`) | 06 | 09 | needs entity context vectors; hook + threshold exist |
| ~~Journey overlap signal in resolution~~ | 06 | 07 ✅ | `loadJourneyLinks()`; null (not zero) when either side is in no journey; arcs pass under three variants |
| Re-score `links` on merge / split; prediction retraction on reprocess | 06 | 08 | no links / outcomes yet; ids kept stable |
| Per-reading lock against overlapping extraction jobs | 06 | 12 | dedupe covers `queued` only |
| `MemoryPanel` / entity controls in `/dev/ui` | 06 | 12 | islands bound to actions; `InferredChip` is in the gallery |
| Confirmed links in `links.json` | 05 | 08 | `LINK_KINDS` |
| Markdown / PDF export | 05 | 12 | v2 by design |
| Account-deletion storage sweep (`removeUserStorage()` exists, tested) | 05 | 12 | called by the test harness now; the account job must call it |
| `purge_deleted` sweep scheduling (`{readingId: null}`) | 05 | 12 | cron entry / script; today only per-reading jobs are enqueued |
| Purge e2e users' export archives | 05 | 12 | with the `%@test.local` user purge |
| `rng.deck_id` on a digital reading whose deck was changed in edit | 05 | when `rng` is surfaced | the draw record stays as the audit of the original draw |
| Comprehension check of the Journey screen with an unfamiliar person (§22), answer recorded verbatim in the 07 report | 07 | owner (any time) | no second person in the session |
| Real-model `pnpm eval` for `propose_journey`, human read of the three baselines, then `FLAG_JOURNEY_AUTOCREATE=true` | 07 | owner (any time) | no provider key; mock baselines recorded |
| `semantic_similarity` (0.25 weight) in journey affinity | 07 | 09 | needs retrieval-document vectors; renormalised out meanwhile |
| Events, outcomes, connections on the Journey screen; polymorphic-member RLS for `life_event` rows | 07 | 08 | `TimelineEntry` union and placeholders ready |
| `journey_narrative` header; scoped "Ask about this journey" | 07 | 10 / 09 | deterministic header and a disabled button until then |
| `MemberControls` / `SuggestedJourneyCard` / `JourneyPanel` in `/dev/ui` | 07 | 12 | islands bound to actions |
| Re-evaluate existing memberships after many corrections; journey scroll instrumentation at 100+ | 07 | 12 | one-tap remove is the correction path; 100-member read is 5 queries |
