# Progress Ledger

The first thing to read in any new session. Update it at the end of every phase.

**Current state:** Phase 01 complete — sign up / in / out / reset (email+password, magic link,
Google), 4-step resumable onboarding with a real decline-AI path, `profiles` / `user_flags` /
`reminder_settings` with RLS proven, Profile screen with real consent + depth controls and labelled
placeholders, Home shell, two demo users. Full gate green (56 e2e × 6 runs).
**Next phase:** [Phase 02 — Deck reference: RWS + Thoth](phases/phase-02-deck-reference.md)

## Phase status

| # | Phase | Status | Report | Notes |
|---|---|---|---|---|
| 00 | [Foundations & rails](phases/phase-00-foundations.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-00-report.md) | 2026-09-12 · local Supabase on ports 55321–55329 |
| 01 | [Auth, profile, onboarding](phases/phase-01-auth-onboarding.md) | ⚠️ complete with deferrals | [report](phases/completed/phase-01-report.md) | 2026-09-12 · Google OAuth needs owner credentials to finish end to end |
| 02 | [Deck reference: RWS + Thoth](phases/phase-02-deck-reference.md) | ⬜ not started | — | |
| 03 | [Reading loop (no AI)](phases/phase-03-reading-loop.md) | ⬜ not started | — | |
| 04 | [AI boundary + interpretation](phases/phase-04-ai-interpretation.md) | ⬜ not started | — | |
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
| `opening-reading-makes-no-ai-call` | 03 | ⬜ |
| `thoth-never-substitutes-rws` | 02 | ⬜ |
| `model-cannot-create-confirmed-fact` | 04 | ⬜ |
| `reading-survives-ai-failure` | 04 | ⬜ |
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

- Thoth artwork: shipping text/typographic treatment only. Revisit if licensed or commissioned art
  becomes available (Phase 02 decision, §6.7 artwork rights).
- Pricing numbers are placeholders until retention data exists (§14).
- Google OAuth credentials: not present in any environment yet. The flow is wired and tested up to
  the provider redirect; the owner must create a Google OAuth client and export
  `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET` (local) / set them on the hosted project.
- Local Supabase runs on ports 55321–55329 (another project owns 54xxx on the dev machine).
  `.env.example`/README/CI all use 55xxx; nothing depends on the defaults.

## Deferred items backlog

Phases append here when they defer something, so nothing is lost between sessions.

| Item | Deferred in | Moved to | Reason |
|---|---|---|---|
| Install PWA on a physical phone, verify offline shell | 00 → 01 | 03 | No device in either session; manifest/SW verified by e2e only |
| Google OAuth end to end with real credentials | 01 | owner / 12 | No client ID/secret available; wired and tested to the provider redirect |
| Shared auth rate-limit store (in-memory today, per instance) | 01 | 12 | `RateLimitStore` interface ready; Supabase Auth limits sit behind it |
| `profiles.default_deck_id` FK to `decks` | 01 | 02 | `decks` table does not exist yet |
| Purge `%@test.local` users created by e2e runs | 01 | 12 | Harmless locally; CI DB is ephemeral |
| `ai_calls` write in `telemetry.ts` | 00 | 04 | Table lands in 04; sink interface + memory sink in place |
| Real per-user budgets (`BudgetPolicy`) | 00 | 11 | `usage_counters` lands in 11; hook wired and tested |
| Sentry source-map upload | 00 | 12 | Scrubbing proven without it |
