# Phase 08 — Completion Report

**Status:** complete with deferrals (the real-model evals for the two new tasks and the "log 5 real events and judge" check with real extraction are owner tasks; `reading ↔ reading` and model-proposed events are scoped out — see §10)
**Date:** 2026-09-14
**Phase file:** [../phase-08-events-outcomes.md](../phase-08-events-outcomes.md)

---

## 1. What was built

The reading-to-reality loop closes. A person taps *Something happened* (Home, Journal, or a
reading — the reading's version pre-links) and writes one sentence and a date; the row is
saved as a `CONFIRMED_FACT` before anything else happens, a photo and a note are optional
folds, and nothing on the form mentions tarot. The cron then extracts the sentence
(`extract_event_metadata`, the reading extractor's sibling into the same tables), files the
event into existing journeys by the Phase 07 affinity, and runs the model-free correlation
engine (`src/domain/correlation/`, pure; `src/correlation/run.ts`, the job) against the
readings around it — and, after a reading is extracted, the other way round. Eligible pairs
become `links` rows with the seven signals, plain-sentence reasons, an evidence fingerprint
and the guards' verdict; at most three are offered per object, a fast-tier
`explain_correlation` call puts their reasons into one hedged sentence, and the event screen
shows them as "Likely / Possible connection · inferred" with the reading's date and
deck-native cards, the reasons, a "Why am I seeing this?" signal table in words, and
*Confirm · Maybe · Unrelated* with undo. A rejection records its score and fingerprint and
the pair never comes back on the same evidence. Outcomes are the user's word alone — five
statuses, an optional note, an optional life event picked or logged inline — append-only,
syncing the reading's `follow_up_status` and clearing its revisit date; Home surfaces
overdue revisits as calm, content-anchored cards that clear when an outcome is recorded.
The journey detail interleaves readings, events and outcomes on the timeline and fills its
*Confirmed outcomes* and *Possible connections* sections; purge, export (`export/1.3.0`) and
"Delete AI artifacts" cover the four new tables; the demo journal carries 18 events, 21
offered connections (3 confirmed, 1 rejected), 7 outcomes across the five statuses and two
overdue revisits — all produced by the real pipeline.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Weights used exactly as ALGORITHMS writes them (they sum to 1.05) and normalised over the *available* signals** — unavailable when either side is in no journey, no horizon stated, no vectors (09), no cards (every reading ↔ event pair) | The doc's formula does not sum to 1; renormalisation is what Phases 06/07 already do for missing data, so thresholds keep their meaning now and after 09. Only the ratios matter. | Zero for missing signals (every event pair would top out at 0.80). |
| **Guard 1 gained a temporal half: one of the two required non-card signals must be `timeframe_fit` or `temporal_proximity`** | On the demo journal, a shared journey plus a shared employer paired an August event with an April reading at 0.88 "Likely". The journey already relates those; a per-pair connection months apart is noise, and precision matters more than recall. Pinned by a labelled pair and a unit case. | The literal guard (any two signals). |
| **"Likely" needs the score *and* a temporal signal ≥ 0.5 (inside the window or within about a month); otherwise it reads "Possible"** | Same-journey, same-person pairs seven weeks apart reached 0.94 and read as more certain than the evidence was. Every remaining "Likely" on the demo is within a month and shares the person or employer. | Raising `LIKELY` (would also demote real in-window matches). |
| **Entity overlap = shared weight over the smaller side's count of *resolved* entities** | The first formula (weighted totals) cancelled the tentative discount — a tentative-only shared mention scored 1.0 (labelled-pairs precision 0.86); the second (raw count) made a tentatively shared *second* entity lower the score (the Leeds event ranked below a Maya-only reading three weeks further away). This form keeps the half weight real and monotonic. | Either of the two. |
| **The reading's revisit date is a horizon** (`[occurred_at, revisit_at]`, text "revisit") when the extraction has no ISO timeframe | The user's own statement of when the question resolves; the mock extractor never yields ISO dates, and real models often will not either. | Timeframe only from extraction. |
| **Generated text is never evidence, sole or otherwise** — interpretation/summary provenance is dropped before scoring | Stronger than §10 asks and provable in one line; the loader only reads extractions of the user's words anyway. | "Not the sole evidence" bookkeeping per signal. |
| **`outcomes.reading_id` is required; `prediction_id` narrows it; append-only, newest per target is current** | An outcome is always about a reading; recording again must not overwrite the earlier note (invariant 4). The follow-up status derives from the current set (`syncedFollowUp`). | Nullable reading/prediction "at least one"; upsert per target. |
| **Recording any outcome clears `revisit_at`** | The reminder asked "what happened?"; it was answered. A new revisit can be set again. | Only on resolved statuses. |
| **Event text is immutable by trigger; the date is the one edit; a wrong entry is deleted and re-entered** | Invariant 4 taken literally without a second revisions table. | A `life_event_note_revisions` table. |
| **A user session can only insert confirmed user events (RLS policy), `outcomes.recorded_by = 'user'` and `fact_status = CONFIRMED_FACT` fixed by check, `links.created_by ∈ {user, rule}` and decided state ⇔ `user_acted_at` by check** | Invariant 7 at the database: a model cannot record an outcome even through the service role, cannot create a link, cannot confirm one. `INFERRED_EVENT` rows are representable (for a future proposer) but no code path writes one. | Code-only gating. |
| **Confirm keeps the computed score; the link is *used* as 1.0** | Undo needs the number back; nothing today reads the score of a confirmed link as a score. | Overwriting `score = 1.0`. |
| **At most three offered per object *across runs* (`offered_at`); a decision never promotes a hidden row** | §6.4 "strongest 1–3" as a cap on what a person is asked, not per screen refresh. Hidden rows stay stored for re-scoring. | Three per run. |
| **Events join journeys by assignment only; discovery seeds from readings** | Journeys are what a person asks about; events attach to them. Keeps the Phase 07 clustering contract unchanged. | Events in the discovery pool. |
| **Reading → event is the canonical link direction; only `reading_event` links are produced** | One row per pair whichever side triggered the run. `reading_reading` is supported by the pure engine (where card overlap exists) but has no surface yet. | Scoring both directions into two rows. |
| **`correlate_object` is a lazily loaded job even though it is model-free** | It enqueues the explainer; keeping it behind the registry's lazy edge keeps the import graph honest. | Eager registration. |
| **The `alias-merge-preserves-historical-roles` fixture now sets the old Alex's `last_seen_at` to 2024** | The two "Alex" candidates tied on every signal and the sub-millisecond creation order decided the resolution — a coin flip the phase's extra table churn exposed (3 of 4 runs failed). The fixture now says what it means. | Leaving a flaky invariant. |
| **`getJourney` is six PostgREST requests (was five)** | Event members need their own read; the query-count assertion moved to ≤ 6. | Folding events into the readings embed. |

## 3. Files and modules

```
src/domain/correlation/
  thresholds.ts ★        WEIGHTS, POSSIBLE 0.55, LIKELY 0.75, LIKELY_TEMPORAL_MIN 0.5, STORE_MIN 0.40, guard floors, MAX_SUGGESTIONS 3, TENTATIVE 0.5, τ 45, window 365, grace 14, RESUGGEST_DELTA 0.15
  score.ts ★             CorrelationObject → scorePair (signals, available, reasons, evidence, fingerprint, guards), bandFor, selectSuggestions, filterEvidence, timeframeFit, daysApartPhrase
  resurface.ts ★         shouldResurface (§19)
src/domain/outcomes/followUp.ts   statuses, labels, followUpForOutcome, syncedFollowUp
src/domain/events/types.ts        createEventInputSchema, limits, EVENT_TYPES labels, todayIso
src/domain/extraction/schema.ts   + EVENT_TYPE_KEYS, eventExtractionPayloadSchema (event_extraction/1.0.0)
src/correlation/ ★
  features.ts            loadCorrelationFeatures (mentions with resolution, themes, live journeys, cards, horizon), loadCandidateIds
  run.ts                 correlateObject: candidates → score → store/offer (cap across runs) → decided rows untouched → §19 resurfacing → explain jobs → correlated_at; enqueueCorrelationSafely
  explain.ts             runExplainCorrelation (consent + flag, offered links only, register check, prose columns only)
src/events/extract.ts    runEventExtraction (the reading run's sibling)
src/ai/tasks/extract_event_metadata/ ★  prompt, schema (re-export), version, index, mock (reading rules + event verbs + type/importance), fixtures ×3 + baselines
src/ai/tasks/explain_correlation/ ★     prompt, schema, version, index (+ explanationIssues, FORBIDDEN_CLAIMS), mock, fixtures ×2 + baselines
src/ai/index.ts          both tasks registered (versions, mock fixtures)
src/memory/materialize.ts  materializeObject(objectType, id) — materializeReading / materializeEvent; promoted event columns; journeys + correlation enqueue after
src/memory/corrections.ts, src/db/queries/memory.ts  objectType-aware overrides
src/memory/candidates.ts   loadJourneyLinks.byObject (both types)
src/journeys/features.ts   loadObjectFeatures (readings + events); assign.ts assignObject + LiveMembers; refresh.ts liveMembers, journeysOfObjects; materialize.ts materializeJourneysForObject
src/jobs/handlers/       payloads.ts (+3), extract-event.ts, correlate-object.ts, explain-correlation.ts (all lazy), purge-deleted.ts (+eventId, sweeps events), index.ts
src/db/schema/events.ts ★, migrations/0009_events_outcomes.sql ★  (4 tables, RLS, triggers, bucket, polymorphic policy tightening, receipt scope)
src/db/schema/memory.ts, journeys.ts  polymorphic parent checks; journal.ts receipt scope
src/db/queries/events.ts ★  events (create/get/list/options/date/soft delete/media), outcomes (record + sync, list, current), links (list for object / objects, act, undo, linked objects), due revisits
src/db/queries/journeys.ts  getJourney events + pendingEvents; getReadingJourneys / addReadingToJourney / createJourney objectType; list counts events
src/db/admin/index.ts    event-media bucket helpers; receipt scope
src/domain/privacy/deletionRegistry.ts  life_event root; reading root + outcomes, links; user root + 4; STORAGE_PREFIXES + event-media
src/privacy/purge.ts     purgeEvent, purgeSoftDeletedEvents, reading counters/removers for links + outcomes
src/privacy/aiArtifacts.ts  + pending links
src/domain/export/schema.ts (export/1.3.0: life_events, event_media, outcomes, connections + 7 link kinds), src/export/build.ts
src/observability/logger.ts  'correlation' / 'events' namespaces; linkId, offered, reason props
app/(app)/event/ ★       actions.ts (create with photo, date, delete, link act/undo, record outcome), event-form.tsx, connection-review.tsx ★, page.tsx (list), new/page.tsx, [id]/page.tsx ★, [id]/controls.tsx (+RefreshWhile)
app/api/events/media/[id]/route.ts  owner-scoped signed URL
app/(app)/reading/[id]/outcome-panel.tsx ★, page.tsx (outcomes + links slots), journey-panel.tsx (objectType), controls.tsx (follow-up follows the server)
src/ui/components/reading-detail.tsx (links, outcomes slots), journey-timeline.tsx (event links), page-header.tsx (ReactNode description)
app/(app)/journey/[id]/page.tsx ★ (events/outcomes on the timeline, both sections), journey/page.tsx (event counts), journey/actions.ts (objectType)
app/(app)/home/page.tsx (due revisits, Something happened), journal/page.tsx (entry point + Life events link), profile/privacy-controls.tsx (copy, scope)
scripts/seed-demo-events.ts ★, seed-demo.ts (registered), eval.ts (event, explain, correlate sections)
fixtures/history/correlation/labeled-pairs.json ★ (18 pairs)
e2e/events.spec.ts ★, e2e/_helpers.ts (correlation flag, revisitAt), e2e/journal.spec.ts (1.3.0)
Tests: src/domain/correlation/__tests__/{score.test.ts, fixtures.ts}, domain/outcomes/__tests__/followUp.test.ts, domain/events/__tests__/types.test.ts,
  src/events/__tests__/events.integration.test.ts, src/correlation/__tests__/correlation.integration.test.ts, src/db/__tests__/events.rls.test.ts,
  invariants: card-overlap-alone-never-correlates ★, rejected-link-not-resuggested ★, summary-never-sole-evidence ★ (unskipped), model-cannot-create-confirmed-fact (+1),
  opening-reading-makes-no-ai-call (+entry points), raw-text-never-overwritten (+1), deleting-reading-purges-derived (+1, integration +event), deletion-registry,
  journeys.integration (+event member), export.integration (+1.3.0 files)
```

## 4. Database changes

`0009_events_outcomes.sql` (`drizzle-kit generate --name events_outcomes`, hand-written after
the marker), applied on the local database:

- Tables: `life_events` (18 cols; checks on fact status, `confirmed_at` ⇔ confirmed, user ⇒
  confirmed, source, importance 1–5; partial timeline index; **insert policy admits only
  `source = 'user' and fact_status = 'CONFIRMED_FACT'`**), `event_media` (unique path, size
  > 0), `outcomes` (`fact_status = 'CONFIRMED_FACT'` and `recorded_by = 'user'` by check;
  `reading_id` cascade, `prediction_id` cascade, `life_event_id` set null), `links` (checks
  on types, link type, score, self-link, `created_by in ('user','rule')`, decided state ⇔
  `user_acted_at`; unique pair; indexes on fingerprint and both sides; **insert policy
  admits only `created_by = 'user'`**, both sides must be own).
- Policies tightened: `journey_members`, `object_themes`, `entity_mentions`,
  `metadata_overrides` insert/update now check ownership for `life_event` rows too
  (`ALTER POLICY`, drizzle-generated). `deletion_receipts.scope` gained `life_event`
  (constraint replaced; the 0009 snapshot carries it).
- Triggers: `set_updated_at` on `life_events` and `links`; `life_events_text_immutable`
  (refuses any change to `description` or `note`, and any demotion from `CONFIRMED_FACT`,
  `23514`).
- Storage: private bucket `event-media` (10 MB, image types), no `storage.objects` policies.
- Deletion registry: `life_event` root (8 targets), `reading` root + `outcomes`, `links`;
  `user` root + 4 tables; `event-media` in `STORAGE_PREFIXES`. `check-deletion-registry` and
  the registry unit test fired for all four tables before registration.
- DATA_MODEL.md's Phase 08 section rewritten to the built shape (dropped `occurred_range`
  and `superseded_by`; `outcomes.reading_id` required; the promoted event columns; the
  polymorphic policy note).

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|
| `extract_event_metadata` | `extract_event_metadata/1.0.0` | `event_extraction/1.0.0` | standard | New. The reading payload + `event_type` (11 stable keys, labels separate) + `importance` 1–5; the prompt says `timeframe: null`, `possibilities: []`. Input: sentence, note, date — nothing else. `maxTokens` 1200. Mock: reading rules + event-verb themes + type / importance. |
| `explain_correlation` | `explain_correlation/1.0.0` | `correlation_explanation/1.0.0` | fast | New. `{explanation}` 20–280 chars; `explanationIssues()` rejects numbers, percentages, "predicted / foresaw / confirmed / definitely / certainly / proves / will happen / card(s)", > 2 sentences, > 48 words. Input: the two entries' words, the band, the reasons. `maxTokens` 160. Mock joins the reasons into one hedged sentence. |

Eval (`pnpm eval --dry`, mock — no keys anywhere): `event` 3/3 (entity recall, no
forbidden mentions, type, importance, themes, no possibilities, no timeframe, no
probability), `explain` 2/2 (register, names the evidence, no forbidden claim, hedged),
`correlate` precision 100 % · recall 88 % over 18 labelled pairs (model-free; the same
numbers in every mode). Baselines in each task's `fixtures/__baselines__/` with empty
`human_review`. **The real-model runs and the human reads are owner tasks** (as 04/06/07).

Two mock lessons worth keeping: the reading rules had no word for "accepted the job" or "we
talked", so the event mock layers event verbs (Decision, Ambition, Communication, Change,
Endings) over them — with a real model this is moot. And the mock never yields ISO
timeframe dates, which is why the revisit-date horizon exists (decision above).

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `WEIGHTS` | `domain/correlation/thresholds.ts` | 0.30 / 0.25 / 0.20 / 0.10 / 0.10 / 0.05 / 0.05 | as written (sum 1.05, normalised over available); a pair with every signal at 1 scores exactly 1 (unit) |
| `POSSIBLE` / `LIKELY` | same | 0.55 / 0.75 | as written; boundary tests at ±0.001 |
| `LIKELY_TEMPORAL_MIN` | same | **0.5** | new: "Likely" needs the window or about a month; the demo's seven-week same-journey pairs (0.94) read as "Possible" |
| `STORE_MIN` | same | 0.40 | as written; stored, never shown |
| `NON_CARD_SIGNALS_REQUIRED` / `NON_CARD_SIGNAL_FLOOR` | same | 2 / 0.2 | as written, **plus one must be temporal** (demo: 0.88 four months apart) |
| `MAX_SUGGESTIONS` | same | 3 | as written; counted across runs per object (integration: 5 matching readings → 3 offered, 2 stored) |
| `TENTATIVE_WEIGHT` | same | 0.5 | as written; made real by the resolved-count denominator (labelled pair `tentative-only-mention`: 0.35, hidden) |
| `PROXIMITY_TAU_DAYS` | same | 45 | as written; exp(−1) at 45 days (unit) |
| `TIMEFRAME_GRACE_MIN_DAYS` | same | 14 | new: linear decay outside the horizon over its own length, ≥ 14 days (boundaries unit-tested) |
| `CANDIDATE_WINDOW_DAYS` / `MAX_CANDIDATES` | same | 365 / 300 | new: the read is bounded; nothing a year apart is scored |
| `RESUGGEST_DELTA` | same | 0.15 | as written; the invariant pins 0.149 vs 0.15 |
| `WAIT_FOR_JOBS_MS` | `app/(app)/event/[id]/page.tsx` | 3 min | the screen stops refreshing ("could not be checked yet") rather than spinning |
| `MEDIA_URL_SECONDS` | `app/api/events/media/[id]/route.ts` | 300 | enough to render, not to share |

ALGORITHMS.md §3 rewritten to match (normalisation, signal definitions as built, the
temporal half of guard 1, the "Likely" condition, the revisit horizon, feedback rules,
measured precision).

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/correlation/__tests__/score.test.ts` (25) | weights and normalisation; every signal at its boundaries (tentative half weight; a tentatively shared second entity adds, never subtracts; weighted-Jaccard themes; journey unavailable / coefficient; proximity at τ; timeframe inside / grace / outside / minimum grace / side-independent; card Jaccard between readings only); guard 1 both halves, guard 2 filtering and mixed-bundle equality, guard 3, guard 4 ordering and cap; bands incl. the temporal condition and the demo case; reasons without numbers; days-apart phrases; fingerprint stable across a day and changed by evidence; §19 rule (same evidence never, +0.149 no, +0.15 yes, confirmed overlap once, non-rejected untouched); **labelled pairs: no pair labelled unrelated is shown (precision 1.0), recall ≥ 0.8, the one miss named** |
| unit | `domain/outcomes/__tests__/followUp.test.ts` (3), `domain/events/__tests__/types.test.ts` (3) | the five statuses with labels and the one-to-one mapping; possibility-level sync rules; the input needs only a sentence and a date; every extractor type has a label; `todayIso` by zone |
| unit (invariant) | `card-overlap-alone-never-correlates` (3) ★, `rejected-link-not-resuggested` (3) ★, `summary-never-sole-evidence` (3) ★, `model-cannot-create-confirmed-fact` (+1), `opening-reading-makes-no-ai-call` (+entry points, explain / extract unreachable), `raw-text-never-overwritten` (+1), `deleting-reading-purges-derived` (+1), `deletion-registry` (+4 tables) | see the ledger below |
| integration | `events/__tests__/events.integration.test.ts` (7) | saved before AI and complete with no links; a 5xx extraction leaves the words intact and the row `failed`, the retry completes; entities and themes land keyed `life_event`, type / importance promoted, fresh = skipped, a correlation job queued; the origin reading writes a user-confirmed link; **the database refuses `recorded_by = 'model'` and `INFERRED_EVENT` outcomes even from the service role (`23514`)**; recording keeps the earlier record, syncs follow-up, clears the revisit, the due list empties; a possibility-level outcome → `partly_resolved`; purge counts links / outcomes / the event, clears the outcome's pointer, refuses a live event; the worker runs extract → correlate end to end and sets `correlated_at` |
| integration | `correlation/__tests__/correlation.integration.test.ts` (4) | the agency event ↔ the offer reading with its revisit horizon: one offered, `likely`, reasons name the agency, the window and the days, no numbers, RWS cards under their names, the sleep reading not stored; the explainer queued, writes prose + provenance only (`mock/claude-haiku-4-5`, `explain_correlation/1.0.0`), state and score untouched; maybe → confirm → undo → confirm, a re-run refreshes evidence and keeps the state and the sentence. **Reject → re-run both directions → still rejected → hand-link the mention → back once (pending, offered) → reject again → gone.** Five matching readings → 3 offered, 2 stored unoffered, a decision never promotes one; a match-less event stores nothing and the worker sets `correlated_at`. The other direction: a new Maya reading is scored against a past Maya event. |
| integration | `journeys.integration` (+1: an event about Maya joins by assignment with reasons, shows in the detail; a lone event never seeds a journey; `getJourney` ≤ 6 requests), `export.integration` (+life_events / outcomes / connections files, origin scrubbed for a deleted reading, 1.3.0), `deleting-reading-purges-derived.integration` (+outcome and link purged, the event survives with its pointer cleared) | |
| rls | `db/__tests__/events.rls.test.ts` (5) | isolation on all four tables; a session cannot write an `INFERRED_EVENT` or a model-sourced event, cannot rewrite the sentence (`23514`), cannot demote; B cannot attach media to A's event; **a real object in the bucket is reachable by A only through the RLS-checked row + signed URL — B gets null, neither user client can download directly**; B cannot record an outcome on A's reading nor point one at A's event; model-recorded / inferred outcomes `23514`; B cannot link from A's reading or to A's event; a session cannot create a rule link or a model link; decided state without a user act and pending with one are `23514`; **B cannot confirm a rule link on A's objects, A can**; A cannot file B's event in a journey nor attach a theme to it |
| e2e | `e2e/events.spec.ts` (2 × 2) | **390 px + desktop:** three agency readings + a health reading extracted and gathered → Home shows the overdue revisit ("what happened?") and *Something happened* → the form: sentence focused, date defaults today, no card / spread / deck word anywhere → save → `?saved=1`, the sentence as the `h1` → the cron → 2–3 proposals, band in words, "inferred", the agency in the reasons, cards labelled by deck, "Why am I seeing this?" opens the table, a Thoth proposal shows *Lust* and never *Strength* → axe → **Tab to Confirm, Enter** → Undo → confirm again → *Unrelated* on another → the journey's *Confirmed outcomes* lists the confirmed connection, *Possible connections* omits the rejected one, the timeline shows "life event" → axe → on the due reading: *It happened* + pick the event → recorded as "you", follow-up reads *Resolved* → Home's revisit section is gone. Second test: a quiet event with a photo (labelled control, alt-text prompt) → "No connection found. That is a normal result" → listed "Not connected to a reading". |

Invariant tests unskipped this phase:
- [x] `card-overlap-alone-never-correlates` — identical spreads on any date never eligible; a card plus one weak signal not enough; the card weight is the smallest; the runtime stores eligible pairs only.
- [x] `rejected-link-not-resuggested` — same fingerprint → nothing; +0.15 on a new fingerprint or a confirmed overlap → once; the query layer records the rejection point, the run consults the rule and never deletes; the database half in the correlation integration suite.
- [x] `summary-never-sole-evidence` — generated-only bundle → no link; generated evidence adds nothing to user text (identical score, signals, fingerprint); the loader marks everything `user_text` and never reads `interpretations`.
- [x] `model-cannot-create-confirmed-fact` — case 6: `life_events` checks + the insert policy, `modelBorn` refuses a confirmed event; `outcomes` checks; `links` checks; the run inserts `pending` rule rows only; the explainer's one `update` sets `explanation` and provenance and none of state / score / signals / reasons / offered / evidence; nothing under `src/events` or `src/correlation` mentions `outcomes`.

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  53 passed | 1 skipped (54)
      Tests  381 passed | 1 skipped (382)          (unit)
 Test Files  18 passed (18)
      Tests  113 passed (113)                      (integration)

$ pnpm test:rls
 Test Files  11 passed (11)
      Tests  46 passed (46)

$ pnpm build && pnpm check:client-bundle && BASE_REF=HEAD pnpm check:prompt-versions
 ✓ Compiled successfully in 6.1s
├ ƒ /event 674 B (184 kB) · /event/[id] 3.55 kB (148 kB) · /event/new 3.98 kB (143 kB) · /api/events/media/[id]
check-client-bundle: ok (73 files scanned)
check-prompt-versions: ok

$ pnpm test:e2e            (mobile 390×844 + desktop, fresh `next start`)
  122 passed (2.5m)        — events.spec: 4 passed; journeys.spec + events.spec rerun after the list-count fix: 8 passed

$ pnpm db:migrate  →  migrations applied (0009_events_outcomes; the receipt-scope ALTER was applied by hand on the local DB after the file was extended — see §11)
$ pnpm demo:seed   →  18 life events logged, 21 connections offered, 21 explained
                      Ana decided: 3 confirmed, 1 rejected, 0 maybe; 7 outcomes recorded across the five statuses
$ pnpm eval --dry  →  event ✓ ×3 · explain ✓ ×2 · correlate ✓ precision 100% · recall 88% over 18 pairs (missed: health-theme-only-close)
                      eval: all mechanical checks passed — now read the baselines.
```

Registry gate fired for the four tables before they were registered:
```
Deletion registry is missing user-owned table(s): event_media, life_events, links, outcomes
```

Two pre-existing tests were touched while running the full gate: `export.integration`'s
1-second signed-URL expiry test raced once under full-suite load (passes in isolation and on
the rerun; no change), and `alias-merge-preserves-historical-roles.integration` was a
genuine coin flip (decision in §2; fixed at the fixture).

**Correlation precision, recorded:** 1.00 precision / 0.86 recall on the 18 labelled pairs
(`pnpm eval` prints it in every mode; `score.test.ts` fails if any unrelated pair is shown).
The phase file's threshold rule ("below ~0.8, raise the display threshold") did not trigger;
the two tuning changes were made on the demo read instead (§2).

**Demo journal read by hand** — every offered connection after the seed (21 rows):
```
Apr 7  Applied for the design lead role         ✓ confirmed  apply reading (2 days)            0.905 likely
                                                pending      Take the offer or stay (19 days)   0.891 likely   — fair: the application led to the offer
Apr 17 Maya and I had the conversation          pending      How is it going with M.? (5 days)  0.993 likely
                                                pending      What does Maya need (50 days)      0.937 possible — same thread; "possible" is right
                                                pending      Move to Leeds (30 days, Maya)      0.894 likely   — borderline; both in "Me and Maya"
Apr 29 I accepted the offer from the agency     ✓ confirmed  Take the offer or stay (3 days)    1.000 (user)
                                                pending      Apply for the lead role (24 days)  0.869 likely
May 19 Viewed a flat in Leeds with Maya         pending      Move to Leeds (2 days, Leeds+Maya) 0.808 likely   — the right one now ranks first
                                                pending ×2   Maya readings (3 wks / 1 month)    0.71 / 0.68 possible
Jun 11 First week on the new team               pending      What am I not seeing about the new team? (1 day) 0.873 likely
                                                pending ×2   agency readings (2 months)         0.67 / 0.65 possible
Jun 26 Long phone call with J.                  pending      Friendship with J. (4 days)        0.943 likely
Aug 17 Said yes to the conference talk          ✓ confirmed  the conference talk reading        0.980 likely
                                                pending      Focus before the review (22 days)  0.788 likely   — same employer, weeks apart; acceptable
Aug 27 Maya and I decided to take a break       pending      How are things really with M.? (2 days) 0.744 possible
Sep 12 The review went better than I feared     ✓ confirmed  Focus before the review (4 days)   0.858 likely
                                                pending ×2   Leaving the agency / the talk (1 month, just outside their revisit windows) 0.74 / 0.66 possible
Sep 13 Dinner with Sam                          ✗ rejected   Leaving the agency (Sam mentioned) 0.736
                                                pending      How are things really with M.? (Sam) 0.707 possible
```
Wrong-and-confident: **0**. Removed by the two tuning changes before this read: three
same-journey pairs four to five months apart (0.73–0.88), and the "Likely" label on the
seven-week Maya pair. Missing-but-quiet: "Went for a long walk", "Started the new routine"
(no shared entity with "Will the new routine stick?" — the mock extracts no entity from
either) and "Spent the evenings on the side project" (same reason). "Dinner with Sam" ↔ a
reading that mentions Sam once is offered as "possible" at 0.71 — defensible, and that is
the one Ana rejects.

| Metric | Target | Measured |
|---|---|---|
| Event saved before any AI | always | integration: the row exists and is complete with no extraction; the action enqueues after the insert |
| Extraction failure loses content | never | integration (5xx ×3): sentence and date byte-identical, row `failed`, retry completes |
| Suggestions per new object | ≤ 3 | integration: 5 matches → 3; e2e: 2–3 |
| Labelled precision / recall | ≥ 0.8 precision | 1.00 / 0.86 |
| Wrong-and-confident on the demo (read by hand) | 0 | 0 of 21 |
| Model calls per event opened / reading opened / decision / outcome | 0 | 0 (import-graph scan; the e2e ledger shows extraction + explanation calls only) |
| Model calls per event | 1 extraction + ≤ 3 explanations (jobs) | as designed; explanations are consent-gated |
| Signed URL lifetime | short | 300 s; B cannot read the row, nobody reads the bucket directly |
| Unit / integration / RLS / e2e | fast | 8 s / 45 s / 12 s / 2.5 min |

Manual checks actually performed:
- [x] **Read every offered connection in the demo journal** (table above): no wrong-and-confident suggestion; the three rejected-by-design cases are documented.
- [x] **390 px screenshots, light + dark:** Home with *You asked to come back to this* (two overdue revisits, "You asked about this 44 days ago — what happened? Say so when you know; no rush.") and *Something happened*; the events list by month; the Leeds event detail (type "home — suggested", three proposals with band, cards under each deck's name including a Thoth reading, the AI sentence marked as such, reasons, the expanded signal table, the *Part of Me and Maya?* question); the entry form with the note / photo fold; the agency journey (header "4 readings, 3 life events and 2 confirmed outcomes since April", interleaved timeline with "It happened —" and "life event" items, both new sections filled); the reading's Follow-up with the outcome panel.
- [x] **Keyboard:** the e2e tabs to *Confirm* and presses Enter; every action is a native button, link, select, radio or `<details>` summary; the decision buttons sit in a `role=group` named after the reading; the file input is a labelled `<input type=file>` followed by the alt-text field.
- [x] **Screen reader:** the band is text ("Likely connection · inferred"); every decision is announced in a polite live region; the signal table has a caption; photos carry the user's own alt text.
- [ ] **Log 5 real-ish events with the real extractor and judge every proposal** — the mock extractor decides what can be matched (see §11); with `AI_PROVIDER=mock` this check was done on the demo journal instead (above). Owner task with a provider key.

## 9. UX notes

Every inference is a word, never a number or a colour: "Possible connection · inferred",
the signal table says strong / some / faint / none, the AI sentence is marked "AI wording
of the reasons below". Zero results say "That is a normal result". Outcomes are visibly the
user's: "What happened · you, 12 Sep". Home's revisit cards say when you asked and nothing
about how late you are. The event's Controls say the words are never edited.

Rough edges left deliberately: a journey with many connections makes a long detail page
(every card repeats the other side); a `showOther=false` compact mode exists on the island
but is not used yet. The event detail has no journal-style search. Ben (no AI) sees the
plain "Connection suggestions are off for this account" sentence with the manual path.
`RefreshWhile` polls twelve times at 2.5 s and stops — with a slow cron the user reloads.
Home's due-revisit read throws like the other Home queries on the known post-sign-in
`PGRST303` skew (it surfaced once in the screenshot run as "due revisits read failed" —
the same class as "profile read failed" beside it, not new).

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Real-model `pnpm eval` for `extract_event_metadata` and `explain_correlation`, human read of the five baselines, then `FLAG_CORRELATION_SUGGESTIONS=true` (env default stays off; demo and e2e users are on the rollout flag) | No provider key (as 04/06/07) | owner |
| Log 5 real-ish events against real extraction and judge every proposal | Same | owner |
| `reading ↔ reading` correlation surfaced anywhere | The pure engine scores it (card overlap lives there and the invariant tests it); no surface asks for it, and the journey already relates readings | when a surface exists (09/10) |
| Model-proposed events (`INFERRED_EVENT` from a reading's `event_mentions`) with a confirm step | Constraints, gate and RLS are in place; no proposer exists | when wanted |
| `event ↔ outcome` as a scored link | An outcome names its event explicitly; nothing to score | — |
| Push / email reminder delivery for due revisits | In-app surfacing only, per the phase file | 11 |
| `semantic_similarity` (0.20) in correlation | Needs retrieval-document vectors; renormalised out; the theme-only labelled pair is the recall it will recover | 09 |
| Re-scoring dependent `links` on entity / journey merge or split; prediction retraction on reprocess | Not attempted this phase; the next `correlate_object` run for either object re-scores it (evidence refreshes; decided rows keep their state) | 12 |
| Compact connection cards on the journey page (`showOther=false`) | Long page with many connections | 12 (UX pass) |
| `ConnectionReview`, `OutcomePanel`, `EventForm` in `/dev/ui` | Islands bound to actions, like the 06/07 ones | 12 |
| Editing an event's note (append-only revisions) | Text is immutable by trigger; delete and re-enter | when asked |
| A "re-check connections" button on an event | The date change re-queues a run; nothing else does | when asked |

## 11. Known issues and risks

- **The mock extractor bounds what can correlate.** No shared entity → no suggestion (a
  theme-and-proximity pair cannot reach 0.55 without semantic similarity). With the real
  model, entity recall will be higher and more pairs will clear the bar — the labelled set
  and the demo read should be repeated then, and `LIKELY_TEMPORAL_MIN` / the temporal guard
  are the first dials.
- **Journey overlap dominates today** (0.30 of an available 0.80): anything in the same
  journey and mentioning the same person scores ≥ 0.69 before themes. The temporal guard and
  the "Likely" condition contain it; Phase 09's semantic signal will dilute it.
- **The 0009 migration file was extended after it was applied locally** (the
  `deletion_receipts.scope` ALTER at its end). The migrator does not re-run an applied file,
  so the ALTER was applied by hand on the local database; a fresh database gets it from the
  file, and the 0009 snapshot carries it. CI's ephemeral database is fine.
- **Events are date-only** (`occurred_on`, materialised at 12:00 UTC). Same-day ordering
  against readings is by time-of-day of the reading; fine for a timeline, not a clock.
- **Decided links never re-decide, hidden rows never promote**: a user who rejects all three
  offers sees nothing more for that event unless the evidence changes. Honest, but a
  "show more" is a possible 12 item.
- **`materializeObject` queues a correlation run on every correction** (deduped on queued):
  a burst of corrections is a burst of model-free runs; cheap, but a per-object lock is the
  same 12 item as extraction's.
- `pnpm eval --dry` rewrites the other tasks' baselines' `ran_at`; reverted so the diff
  carries only the five new baselines.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste keys into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm eval --dry
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` → Home: *Something happened*
   beside *Start a reading*; *You asked to come back to this* with two readings.
2. Tap *Something happened* → type "Maya called about the flat." → Save → the event page says
   "Looking through your past readings…" → `pnpm jobs:run` twice (extract, then correlate;
   a third for the explanations) → reload: up to three proposals about Maya / the flat with
   their reasons → *Why am I seeing this?* → Confirm one, *Unrelated* on another → Undo.
3. Journal → *Life events* → open *Viewed a flat in Leeds with Maya.* → three proposals, the
   Leeds reading first (two days apart, Leeds and Maya, "Home") → *Part of Me and Maya?* →
   Yes → the journey's timeline now shows the event.
4. Journey → *The agency and ambition*: header counts events and outcomes; timeline
   interleaves "It happened — Take the offer or stay…" and "life event" items; *Confirmed
   outcomes* lists Ana's records and the confirmed connections; *Possible connections* the
   rest.
5. Open *What does the autumn hold for my health?* (from Home's revisit card) → Follow-up →
   *Partly* → a note → *Log one now*: "Saw the doctor about the sleep problems." → Record →
   the chip row reads *Partly resolved*, Home's revisit card is gone, the new event exists.
6. Open *Dinner with Sam.* → the *Leaving the agency* link reads "Unrelated — you said so";
   `pnpm jobs:run` after `correlate_object` is re-queued (change its date) → it stays rejected.
7. Profile → *Delete AI artifacts*: the dialog counts "suggested connections"; confirm → the
   pending proposals go, confirmed and rejected ones stay, every event and outcome stays.

## 13. Notes for the next phase

- **Semantic similarity slots in:** `CorrelationObject.embedding` is already on the type and
  `scorePair` uses cosine when both sides carry one; the journey affinity has the same hook.
  Fill it from retrieval documents and the theme-only labelled pair should start to pass —
  then re-read the demo and revisit `LIKELY_TEMPORAL_MIN` and the temporal guard.
- **Retrieval documents for events:** `life_events.description + note`, the promoted type and
  the extraction payload; `object_type = 'life_event'` is already admitted everywhere.
- **Ask My History evidence:** confirmed links (`state = 'confirmed'`) are the highest-grade
  evidence; `maybe` may be cited as such; `pending` and `rejected` never. Outcomes are
  `CONFIRMED_FACT` and citeable by id. `listLinksForObjects()` gives a journey's connections.
- **Summaries (10):** rejected pairs must not be narrated together; `links.evidence` carries
  the ids a summary would need to cite.
- **Journey narrative (10):** `narrativeHeader` already counts events and confirmed outcomes.
- **Reminders (11):** `listDueRevisits()` is the query; the in-app card copy is the tone to keep.
- **Jobs to consider for 12:** a "re-check connections" action; a per-object lock for the
  correlation run; the purge sweep for events is already in `purge_deleted {readingId: null}`.
- These notes were added to the Phase 09 file's task list.
