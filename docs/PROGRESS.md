# Progress Ledger

The first thing to read in any new session. Update it at the end of every phase.

**Current state:** Phase 04 complete with deferrals — a saved reading receives a streaming,
deck-aware, layered interpretation (synthesis → card by card in position → read together →
questions to sit with) generated from the deck's own reference rows after the save, persisted
with model/prompt/schema versions, frozen once complete, superseded (never overwritten) on
regenerate, and never recomputed on open. Real Anthropic + OpenAI-embeddings providers behind
the Phase 00 runner (`runStreamObject` = streaming with the full repair/timeout/backoff/breaker
policy); `interpretations`, `safety_flags`, `question_embeddings`, `ai_calls` tables; deck purity
and hedged register enforced by validator + one repair; §10 safety card once per reading; FR-25
nudge on the third repeated question; thumbs feedback; `/dev/ai-usage`; `pnpm eval` runner with
fixtures and baselines. Invariants live: `model-cannot-create-confirmed-fact`,
`reading-survives-ai-failure`, `opening-reading-makes-no-ai-call` (extended). Full gate green
(100 e2e × 4 runs). **No provider key was available**: the real-model eval run, human review of
baselines and the manual reading of real interpretations are with the owner.
**Next phase:** [Phase 05 — Journal, search, export](phases/phase-05-journal-search.md)

## Phase status

| # | Phase | Status | Report | Notes |
|---|---|---|---|---|
| 00 | [Foundations & rails](phases/phase-00-foundations.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-00-report.md) | 2026-09-12 · local Supabase on ports 55321–55329 |
| 01 | [Auth, profile, onboarding](phases/phase-01-auth-onboarding.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-01-report.md) | 2026-09-12 · Google OAuth needs owner credentials to finish end to end |
| 02 | [Deck reference: RWS + Thoth](phases/phase-02-deck-reference.md) | ✅ complete | [report](phases/completed/phase-02-report.md) | 2026-09-12 · Thoth text-only + no reversals by design; RWS art committed (27 MB) |
| 03 | [Reading loop (no AI)](phases/phase-03-reading-loop.md) | ✅ complete | [report](phases/completed/phase-03-report.md) | 2026-09-12 · Thoth reversals test done on RWS by design; PWA device check still open |
| 04 | [AI boundary + interpretation](phases/phase-04-ai-interpretation.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-04-report.md) | 2026-09-13 · real-model eval + human baseline review need provider keys (owner) |
| 05 | [Journal, search, export](phases/phase-05-journal-search.md) | ⬜ not started | — | ← shippable journal |
| 06 | [Structured memory](phases/phase-06-structured-memory.md) | ⬜ not started | — | |
| 07 | [Journeys](phases/phase-07-journeys.md) | ⬜ not started | — | |
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
| `raw-text-never-overwritten` | 05 | ⬜ |
| `deleting-reading-purges-derived` | 05 | ⬜ |
| `archive-readable-without-subscription` | 05 | ⬜ |
| `alias-merge-preserves-historical-roles` | 06 | ⬜ |
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
  vs host clock skew). Routes that must never block (repeat check) fail soft; nothing else
  handles it specifically.

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
| Change deck or spread of a saved reading | 03 | 05 (if asked) | Edit covers question, date, life area and cards; a deck/spread change invalidates every card, so re-logging is the honest path for now |
| Soft delete (`deleted_at`) for readings | 03 | 05 | Hard delete now (nothing derived exists); the purge job lands with the derived tables |
| Server-side card search RPC / Thoth `strength` ranking | 03 | — | In the Thoth picker, `strength` ranks Nine of Wands (titled *Strength*) above Lust (alias); correct per Phase 02 ranking, noted for UX review |
| Real-model `pnpm eval`, human baseline review, 5 real interpretations read, Thoth zero-RWS against the real model, kill-the-key mid-flow, breaker/timeout against the real provider | 04 | owner (any time) | No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this session; everything is wired and tested against the mock and a fake SDK client |
| Region-aware safety resources | 04 | 11/12 | No region known (`profiles.locale = 'en'`); international + US/UK lines shown |
| Purge `safety_flags` with the reading | 04 | 05 | Keyed by object id, no FK; registered `via: 'job'` |
| Interpretations in journal list / export | 04 | 05 | Query + component ready; list preview = `synthesis` |
