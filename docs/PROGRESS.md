# Progress Ledger

The first thing to read in any new session. Update it at the end of every phase.

**Current state:** Phase 06 complete — saved readings grow structured memory. The
`extract_reading_metadata` job runs after save (cron, never the request), gated on consent and
the `ai_extraction` flag (env default off; per-user `user_flags` rollout), writes append-only
`extractions` (`extraction/1.0.0`, versioned, materialised before marked complete) and derives
themes on a seeded taxonomy, `POSSIBILITY` predictions, and entities through the pure resolver
(`domain/entities/resolve.ts`: exact / trigram / name↔descriptor / role channels, 0.85 · 0.60 ·
0.08 thresholds, one question per reading, temporal roles never rewritten — trigger-enforced).
The reading detail's *Connections* shows every inferred value as a labelled chip with "why?" and
a one-tap correction; corrections are `metadata_overrides` that survive re-extraction and
`reprocess_extractions`. *People & places* under Profile: rename, aliases, roles, merge with a
receipt and undo (`apply_entity_merge` / `undo_entity_merge`), split, remove. Prompt context
excludes tentative entities by construction. Purge, delete-AI-artifacts and export
(`export/1.1.0`) cover all ten new tables; the journal filters by entity. Demo: Maya under four
names with a partner → ex-partner change, an employer, a city, a live merge. Invariants live:
`alias-merge-preserves-historical-roles`; `model-cannot-create-confirmed-fact` extended to
memory rows. Full gate green (114 e2e). Owner-side deferrals: real-model eval for extraction
(then flip the flag), as for 04.
**Next phase:** [Phase 07 — Journeys](phases/phase-07-journeys.md)

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
| ~~Entity~~ / journey filters in the journal | 05 | 06 ✅ / 07 | entity landed in 06 (`entity=` + `EXISTS` on `entity_mentions`); journey follows the same three edits |
| ~~Extractions~~ + summaries in "Delete AI artifacts" and in the export | 05 | 06 ✅ / 10 | extractions, themes, mentions, predictions, entities in both (export/1.1.0); summaries in 10 |
| Real-model `pnpm eval` for `extract_reading_metadata`, human read of the four baselines, then `FLAG_AI_EXTRACTION=true` | 06 | owner (any time) | no provider key; mock baseline recorded (recall 100 %, precision 88 %) |
| Embedding channel for entity candidates (`embeddingSimilarity`) | 06 | 09 | needs entity context vectors; hook + threshold exist |
| Journey overlap signal in resolution | 06 | 07 | renormalised out until journeys exist |
| Re-score `links` on merge / split; prediction retraction on reprocess | 06 | 08 | no links / outcomes yet; ids kept stable |
| Per-reading lock against overlapping extraction jobs | 06 | 12 | dedupe covers `queued` only |
| `MemoryPanel` / entity controls in `/dev/ui` | 06 | 12 | islands bound to actions; `InferredChip` is in the gallery |
| Confirmed links in `links.json` | 05 | 08 | `LINK_KINDS` |
| Markdown / PDF export | 05 | 12 | v2 by design |
| Account-deletion storage sweep (`removeUserStorage()` exists, tested) | 05 | 12 | called by the test harness now; the account job must call it |
| `purge_deleted` sweep scheduling (`{readingId: null}`) | 05 | 12 | cron entry / script; today only per-reading jobs are enqueued |
| Purge e2e users' export archives | 05 | 12 | with the `%@test.local` user purge |
| `rng.deck_id` on a digital reading whose deck was changed in edit | 05 | when `rng` is surfaced | the draw record stays as the audit of the original draw |
