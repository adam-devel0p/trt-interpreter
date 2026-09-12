# Phase 07 — Journeys

**Deps:** 06 · **Spec:** §6.5, FR-10, FR-16, FR-17, §6.7 cross-deck, §19 · **Outcome:** the
differentiating screen exists: journeys form themselves from evidence, and a Journey shows an
interleaved timeline, theme progression and recurring symbols — with every historical card still
displayed under its original deck identity.

## Scope

**In:** `journeys`, `journey_members`, `journey_theme_progression`, assignment + creation algorithms,
`propose_journey`, Journey list + detail screen, journey management (accept, rename, merge, split,
close, remove member), journey filter in Journal.

**Out:** life events (08) — the timeline is readings-only for now but must be built to interleave.
Journey narrative header and AI summary (10) — a deterministic header is used until then.
Scoped Journey Q&A (09).

## Tasks

### 1. Schema
Tables per [../DATA_MODEL.md](../DATA_MODEL.md#journeys--phase-07), RLS on all three.
`journey_members` unique on `(journey_id, object_type, object_id)`.
`journey_theme_progression.source_object_ids` is `not null` with a non-empty check — a progression step
without evidence is not representable.

### 2. Assignment & creation
Implement exactly [../ALGORITHMS.md](../ALGORITHMS.md#2-journey-assignment-65-fr-10):
- Affinity scoring in `src/domain/journeys/affinity.ts` (pure, fixture-tested).
- ≥0.70 auto-assign · 0.50–0.70 pending suggestion inline on reading detail · <0.50 nothing.
- Auto-create on ≥3 objects clustering ≥0.60 across ≥14 days with a shared resolved entity or stable
  theme pair; `status='suggested'` for weaker clusters.
- `propose_journey` names it; **the user renaming pins the title** against model renaming.
- Runs as a job after extraction; gated by `flags.journey_autocreate`.
- The user never has to create or file anything (invariant 10) — but can do all of it manually if they want.

### 3. Journey detail screen (§6.5 — the product's centrepiece)
Sections in this order, each with a real empty state:
| Section | This phase |
|---|---|
| **Narrative header** | Deterministic, honest sentence from real counts ("14 readings and 2 confirmed outcomes since March"). Replaced by `journey_narrative` in Phase 10. |
| **Timeline** | Interleaved chronological items — readings now, events/outcomes slot in Phase 08 without a rewrite. Sticky month markers; each item shows deck accent and deck-native card names. |
| **Theme progression** | Labelled sequence (uncertainty → conflict → decision), each step tappable to its source objects. Never a chart (§4.3). |
| **Recurring symbols** | Cards/suits/themes recurring **with context** — "The Tower appeared in 3 readings, twice within a week of a confirmed event" — not raw counts (§3.3). Each shows its source readings. |
| **Open loops** | Readings with unresolved follow-up or a passed revisit date. |
| **Confirmed outcomes** | Placeholder until 08; visible section with empty state. |
| **Possible connections** | Placeholder until 08; clearly labeled inferred when populated. |
| **Ask about this Journey** | Disabled, labeled "coming soon" until 09. |

**Cross-deck rule (§6.7, §19):** a Journey may mix RWS and Thoth readings; theme analysis may generalise
across them, but every card is always rendered with its own deck's name and treatment. A test asserts a
mixed-deck Journey renders both identities correctly and never a mapped equivalent.

### 4. Journey list & management
- Journey list: active first, then suggested (one card, dismissible), then dormant/closed.
- Suggested journeys surface on Home as a single non-nagging card; dismissal is remembered permanently.
- Management: accept, rename, merge, split, close/reopen, remove a member (one tap, with undo).
  Removing a member never deletes the reading.

### 5. Journal integration
Add a Journey filter to Phase 05's filter set; reading detail shows its journey membership with
confidence treatment (auto vs pending vs user-confirmed).

### 6. Demo data
Seed 3 journeys of different shapes: a mature relationship arc (mixed RWS + Thoth), a career arc
(RWS only, several open loops), and a weak suggested journey the tester can accept or dismiss.

## Test plan

- [ ] Unit: affinity scoring on `fixtures/history/` — every threshold boundary; clustering creates a
      journey at exactly 3 objects/14 days and not at 2; theme progression collapses consecutive
      duplicates and drops steps with <2 supporting objects.
- [ ] Integration: assignment job runs after extraction; renaming pins the title (a later model
      proposal does not change it); merge moves members and dedupes; split re-evaluates; dismissal is
      not re-suggested.
- [ ] Cross-deck: a mixed journey's timeline shows Thoth cards with Thoth names and RWS with RWS names;
      archetype mapping never reaches a render path.
- [ ] **RLS** on all three tables; B cannot add a member to A's journey, nor read A's progression.
- [ ] Evidence integrity: every progression step and every recurring-symbol claim resolves to existing,
      non-deleted source objects; deleting a source updates or removes the claim.
- [ ] E2E at 390px on demo data: open a journey → scroll the timeline → tap a progression step to its
      sources → tap a recurring symbol to its readings → accept a suggested journey → rename it →
      remove a member and undo.
- [ ] a11y: timeline is a semantic list with month headings; progression sequence is readable as text
      by a screen reader (not only as a visual); tap targets ≥44px.
- [ ] Performance: a journey with 100 members renders and scrolls smoothly; no N+1 queries (assert
      query count in an integration test).

Manual:
- [ ] Show the Journey screen to someone unfamiliar and ask what it is, without explaining (§22:
      "Do they understand Journey without explanation?"). Record their answer verbatim in the report —
      that is the phase's real acceptance signal.

## Exit criteria

- [ ] Journeys auto-create and auto-assign to documented thresholds; suggestions are quiet and
      dismissible-forever.
- [ ] Journey detail has all eight sections with honest empty states and a timeline built to interleave.
- [ ] Theme progression and recurring symbols are contextual and evidence-linked, not counters.
- [ ] Mixed-deck journeys preserve every card's original deck identity (tested).
- [ ] Full management set works with undo; nothing requires manual filing.
- [ ] Comprehension feedback from at least one unfamiliar person recorded.
- [ ] Report + `../PROGRESS.md` + `../ALGORITHMS.md` threshold updates.
