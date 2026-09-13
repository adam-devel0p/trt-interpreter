# Phase 08 — Life Events, Outcomes & the Correlation Engine

**Deps:** 07 · **Spec:** §6.4, §8.2, FR-11–FR-15, §10, §19 · **Outcome:** the reading-to-reality loop
closes. A user records "I accepted the new job today" in one sentence, the system proposes at most three
scored connections to past readings with visible reasons, and the user confirms, defers or rejects —
with rejections remembered.

> This is the product's core differentiator (§3.3 "own the reading-to-reality loop"). Precision matters
> more than recall: a wrong confident connection damages trust more than a missing one.

## Scope

**In:** `life_events`, `event_media`, `outcomes`, `links`; quick event entry; `extract_event_metadata`;
correlation scoring engine; `explain_correlation`; connection review UI; revisit windows and reminders-
in-app; outcome status; Journey timeline interleaving; Journey *Confirmed outcomes* and *Possible
connections* sections.

**Out:** push/email reminder delivery (11 — in-app surfacing only here). Ask My History (09).

## Tasks

From Phase 07 (see [completed/phase-07-report.md](completed/phase-07-report.md) §13):
- **Timeline union is ready:** `TimelineEntry` (`src/domain/journeys/timeline.ts`) has `event` and
  `outcome` members and `JourneyTimeline` renders them; `journey_members.object_type` already
  admits `life_event` and `outcome`. Add event/outcome members and extend `getJourney()`'s read.
- **RLS for polymorphic members:** `journey_members`' `ownsObject` checks readings only — the 08
  migration must add an `exists` on `life_events` for `life_event` rows (and the RLS test).
- **Features for events:** `loadReadingFeatures` (`src/journeys/features.ts`) is reading-only; an
  event loader over `life_events` + its `object_themes` / `entity_mentions` feeds the same
  `ObjectFeatures` shape, and `assignReading` needs an event sibling.
- **`refreshJourney` is the one derived-rows hook** (activity, status, progression) — call it after
  any write that changes a journey's live members (`auto` / `confirmed` only; `pending` is not yet
  part of it).
- **Sections to fill:** `app/(app)/journey/[id]/page.tsx` renders *Confirmed outcomes* and *Possible
  connections* as placeholders in the right order; `narrativeHeader` already takes
  `confirmedOutcomes` and `events`.
- **Correlation inputs:** `journeysOfReadings()` (`src/journeys/refresh.ts`) gives the journeys a set
  of readings sit in (the journey-overlap signal of §3); `loadJourneyLinks()` in
  `memory/candidates.ts` gives entity ↔ journey membership.
- **Purge:** the reading purge refreshes affected journeys after the delete; the event purge must do
  the same. **Export** is at `export/1.2.0` (`journeys.json` nests progression) — events, outcomes
  and links bump it to 1.3.0.
- **Still open from 06/07:** prediction retraction on reprocess and re-scoring dependent `links` on
  entity or journey merge/split (`apply_journey_merge` moves member rows only).


### 1. Schema
`life_events`, `event_media`, `predictions` (extended), `outcomes`, `links` per
[../DATA_MODEL.md](../DATA_MODEL.md#events-predictions-outcomes-links--phase-08). RLS on all.
`links` unique on the pair+type; `evidence_fingerprint` indexed. `life_events.fact_status` is
`CONFIRMED_FACT` when user-entered, `INFERRED_EVENT` when model-proposed — enforced by the write gate.

### 2. Quick event entry (§6.4 — speed is the feature)
- Reachable in **one tap from Home and from Journal**, and from a reading ("something happened about
  this").
- One sentence + optional date (defaults today, back-dating easy), optional photo, optional note.
  **No multi-field form. No required tarot framing** — an event can exist with no reading link (§6.4).
- Saves transactionally, instantly, before any AI (invariant: content first).
- `extract_event_metadata` runs as a job: event type, entities, topics, emotional tone, importance,
  timeframe, journey candidates. Same extraction family and override mechanics as Phase 06.

### 3. Correlation engine (§8.2)
Implement exactly [../ALGORITHMS.md](../ALGORITHMS.md#3-correlation-scoring-82-fr-12-fr-13) in
`src/domain/correlation/` — pure functions over an evidence bundle:
- The seven weighted signals, with `signals` and `reasons` persisted for explainability.
- **Guard 1:** card/symbol overlap is never sufficient alone (≥2 non-card signals >0.2 required).
- **Guard 2:** no self-validating loops — an interpretation or summary may never be the sole evidence
  that a real event occurred (§10).
- **Guard 3:** zero candidates is a valid, plainly-stated result (§10 no forced correlation).
- **Guard 4:** at most 3 suggestions per new object (§6.4).
- Display bands: <0.55 invisible · 0.55–0.75 "Possible" · ≥0.75 "Likely" · confirmed only by the user.
- `explain_correlation` writes the human-readable reason for a score the code already computed; it may
  not invent or upgrade a link.
- Runs as a job after event extraction and after reading extraction (both directions).

### 4. Connection review UI (FR-12, FR-13)
- After an event saves: at most 3 proposals, each showing the reading, its date, its cards, the score
  band and the **actual reasons** ("same person: Alex · your reading's 1–2 month window covers this
  date · related themes: commitment").
- Three actions: **Confirm** · **Maybe** · **Unrelated**. One tap each, undoable.
- "Why am I seeing this?" expands the full signal breakdown (§3.3 explainable memory).
- Rejection stores `evidence_fingerprint`; re-suggestion requires a new fingerprint **and** +0.15 score,
  or a newly user-confirmed entity/journey overlap (§19).

### 5. Revisit windows & outcomes (FR-14, FR-15)
- Revisit dates from Phase 03 now surface: Home shows due revisits ("You asked about the job offer 30
  days ago — what happened?"), content-anchored and never nagging (§15.2).
- Outcome recording: **happened / partly / did not happen / unresolved / no longer relevant**, with an
  optional note, on the reading or on a specific extracted possibility.
- Recording an outcome may link an existing life event or create one inline.
- `follow_up_status` on the reading stays in sync with its outcomes.
- Outcomes are `CONFIRMED_FACT` only through user action; a model may never record an outcome.

### 6. Journey integration
Timeline now interleaves readings + events + outcomes chronologically (FR-16). *Confirmed outcomes* and
*Possible connections* sections populate, the latter clearly labeled inferred with reasons.

### 7. Demo data
Extend seed: ~15 life events across the 6 months, several confirmed reading↔event links, one rejected
link (to prove non-re-suggestion), outcomes of every status, and two overdue revisits.

## Test plan

- [ ] Unit (`fixtures/history/`): scoring on hand-labeled pairs; the card-only pair never surfaces;
      timeframe fit boundaries; proximity decay; tentative entities count at half weight; score bands
      map to the right display state.
- [ ] **Invariant `card-overlap-alone-never-correlates.test.ts` — unskip and pass.**
- [ ] **Invariant `rejected-link-not-resuggested.test.ts` — unskip and pass:** reject, re-run the engine
      unchanged → nothing; add materially new evidence (+0.15 or a confirmed entity overlap) → it may
      return once.
- [ ] **Invariant `summary-never-sole-evidence.test.ts` — unskip and pass** (interpretation/summary-only
      evidence bundles produce no event link).
- [ ] Integration: event saves before extraction; extraction failure leaves the event intact; at most 3
      proposals; confirm/maybe/reject transitions persist with `user_acted_at`; outcome recording syncs
      `follow_up_status`; an event with no links is a normal, complete object.
- [ ] Write gate: a model-authored `links` row cannot be born `confirmed`; a model cannot write an
      `outcome`; a model-proposed event is `INFERRED_EVENT` until the user confirms.
- [ ] **RLS** on `life_events`, `event_media`, `outcomes`, `links`; B cannot confirm a link on A's
      objects; event media signed URLs are owner-scoped and short-lived.
- [ ] E2E at 390px: log "I accepted the new job today" → see ≤3 proposals with reasons → confirm one,
      reject one → open the journey and see both reflected → record an outcome for a due revisit → the
      revisit clears from Home.
- [ ] a11y: proposal cards are keyboard-operable with clear accessible names for Confirm/Maybe/Unrelated;
      inferred status conveyed in text; photo upload has a labeled control and alt-text prompt.
- [ ] `pnpm eval`: correlation precision/recall on labeled fixtures. **Record the numbers.** If
      precision is below ~0.8 on the fixture set, raise the display threshold rather than ship confident
      wrong links.

Manual:
- [ ] Log 5 real-ish events against the demo history and judge every proposal. Wrong-and-confident is a
      phase failure; missing-but-quiet is acceptable (§4.4, §22 "Do they trust or reject suggested
      correlations?").

## Exit criteria

- [ ] One-sentence event entry, no forms, no required tarot framing, saved before AI.
- [ ] Correlation engine implemented with all four guards and full explainability.
- [ ] Confirm / maybe / reject with remembered rejections and honest labels.
- [ ] Revisit surfacing and the full outcome status set, user-only.
- [ ] Journey timeline interleaves readings, events and outcomes.
- [ ] Four invariant tests unskipped and passing; correlation precision recorded.
- [ ] Report + `../PROGRESS.md` + `../ALGORITHMS.md` weight/threshold updates with reasoning.
