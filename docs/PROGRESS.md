# Progress Ledger

The first thing to read in any new session. Update it at the end of every phase.

**Current state:** planning complete, no code written.
**Next phase:** [Phase 00 — Foundations & Rails](phases/phase-00-foundations.md)

## Phase status

| # | Phase | Status | Report | Notes |
|---|---|---|---|---|
| 00 | [Foundations & rails](phases/phase-00-foundations.md) | ⬜ not started | — | |
| 01 | [Auth, profile, onboarding](phases/phase-01-auth-onboarding.md) | ⬜ not started | — | |
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

## Deferred items backlog

Phases append here when they defer something, so nothing is lost between sessions.

| Item | Deferred in | Moved to | Reason |
|---|---|---|---|
