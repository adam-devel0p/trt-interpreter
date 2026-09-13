# Phase 07 — Completion Report

**Status:** complete with deferrals (comprehension check with an unfamiliar person and the real-model naming eval are owner tasks)
**Date:** 2026-09-13
**Phase file:** [../phase-07-journeys.md](../phase-07-journeys.md)

---

## 1. What was built

The product's centrepiece exists. After a reading's structured memory is materialised (after
extraction, reprocess and every correction), a model-free step in `src/journeys/` scores the
reading against the user's active journeys with the §2 affinity (`src/domain/journeys/affinity.ts`,
pure), files it as an `auto` member at ≥ 0.70, asks about it inline at 0.50–0.70 (`pending`), and
then looks for new journeys among whatever is still unfiled: ≥ 3 readings across ≥ 14 days sharing a
resolved entity or a theme pair become an `active` journey, weaker shapes a single dismissible
`suggested` one. Titles are deterministic placeholders until the consent-gated `propose_journey`
job names them through the lazy registry; the user renaming pins the title for good. The Journey
detail (`/journey/[id]`) renders the eight §6.5 sections from stored rows plus pure functions —
an honest counts header, an interleaved timeline built on a `TimelineEntry` union (events and
outcomes slot in without a rewrite), a theme progression whose every step carries
`source_object_ids` (non-empty by check), recurring symbols keyed by each card's own deck
identity with context and sources, open loops, placeholders for outcomes and connections, a
disabled "Ask" — and the full management set: accept, dismiss-forever, rename, close/reopen,
merge with undo, split, delete, add, keep, remove with undo. The reading detail's Connections
gained a *Journeys* row with the confidence treatment (you / suggested / "Part of X?"), Home shows
the one suggestion, the journal filters by journey, purge/export/delete-AI-artifacts cover the
three new tables, and the demo journal carries a mixed-deck relationship arc, an RWS-only career
arc with open loops and three weak suggestions — all produced by the real pipeline, not inserted.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Entity overlap is the overlap coefficient against the journey's *core* (entities ≥ half the members mention), not a plain Jaccard** | Jaccard filed the fixture arc wrongly: a reading naming Maya *and* Leeds scored 0.5 against a Maya journey and never cleared 0.70; real entries routinely name two or three people. With 2–3 members a Jaccard core of "anything anyone mentioned" also let a passing name pull unrelated readings in (first demo run: a two-reading "Sam" suggestion swallowed the whole career arc). | The literal formula. |
| **Theme overlap is directional (share of the reading's theme weight the journey carries), pairs average both directions** | A journey about many things must not dilute a reading that shares its core theme; weighted Jaccard against a spread-out profile capped legitimate matches at ~0.69. | Weighted Jaccard. |
| **`semantic_similarity` is unavailable until Phase 09 and renormalised out** (the remaining weights rescale over 0.75) | Same treatment Phase 06 gave the journey signal: thresholds keep their documented meaning now and later; no moving contract. | Lower thresholds now, raise them in 09. |
| **A shared entity alone yields `pending`, not `auto`** (0.35 + 0.10 over 0.75 = exactly 0.60) | Falls out of the spec's weights and is the conservative reading of §4.4: "Part of *The agency and ambition*?" is a fair question when nothing but the employer is in common. The fixture arc pins it. | Special-casing entity-only matches to auto. |
| **Two-pass clustering: active floor 0.60, suggestion floor 0.25 (`SUGGEST_MIN_AFFINITY`), and a suggestion still needs a shared entity or theme pair** | Under the documented weights a theme-only pair can reach at most 0.40 and a diluted one ~0.30, so "suggested when theme-only" was unreachable at 0.60; 0.25 admits about half the theme weight in common while active. A lone theme in common never becomes a suggestion. | One floor (no theme-only suggestions ever). |
| **Only active/dormant journeys gather by assignment; suggestions grow only through discovery, which grows or promotes an open suggestion instead of duplicating it** | Batch discovery over a history (demo seed, reprocess) forms weak pairs first; letting later assignment attach readings to those hypotheses turned a "Sam" pair into a magnet for six unrelated readings. Now a hypothesis waits for evidence or the user. | Assigning to any non-dismissed journey. |
| **`pending` counts as filed for discovery** | An open "part of this?" question must not also seed a second journey for the same reading. | Treating pending as unassigned. |
| **The journey signal in entity resolution is unavailable, not zero, when either side is in no journey** | Turning `journeysExist` on with the literal Jaccard dragged every candidate down by the signal's weight the moment a user's first journey appeared: "Alex, my girlfriend" fell from auto to tentative. The three `fixtures/history/` arcs now run under three variants (no journeys / a shared journey / journeys elsewhere) and decide the same way; a shared journey may lift a tentative link to auto (documented, asserted). | Overlap 0 for "not in any journey". |
| **`created_by = 'rule'` for discovered journeys, never `model`** | The model names; deterministic code decides. `model-cannot-create-confirmed-fact` scans the rule code for `state: 'confirmed'` / `userConfirmed: true` and finds none. ALGORITHMS said `model`; corrected. | Marking rule-created journeys as model-created. |
| **Members have a `state` (`auto` / `pending` / `confirmed` / `removed`) instead of a `user_confirmed` boolean; a removed row stays; only `auto` and `confirmed` are *live*** | One column answers "how did it get here?" and "may the rule re-add it?"; a removal that deleted the row would be silently undone by the next re-materialisation. A pending question is not yet part of the journey: it feeds neither the progression, nor the affinity of later readings, nor the naming context, nor the entity resolver's journey signal (the first demo run named the career journey after a pending reading's themes). DATA_MODEL updated. | Boolean + deleting removed rows. |
| **Merge and split are Postgres functions as the caller; merge closes the source with `merged_into_id` and a snapshot; undo restores exactly** | Same pattern as `apply_entity_merge`: atomic, RLS-scoped, reversible. | Deleting the source (no undo). |
| **The naming job's write is `where title_source <> 'user'`** | A rename landing while the model runs must win; the integration test races one. | Checking before the call only. |
| **`journey_autocreate` gates the whole automatic pipeline (assignment + discovery + naming); manual journeys work regardless** | Env default off, per-user rollout through `user_flags` like `ai_extraction`; e2e and demo opt in. | Gating creation only. |
| **`journeys.user_confirmed` is set by any user action; "Delete AI artifacts" removes only untouched journeys and `auto`/`pending` memberships** | A journey the user accepted, renamed or built is theirs; its evidence rows may still go. | Deleting all journeys. |
| **Undo for a removed member lives in a journey-level bar (`UndoProvider`)** | The removed item re-renders away with its controls; the first e2e run lost the Undo button. | Undo inside the item. |
| **The mock namer joins subject and strongest theme plainly ("Maya and distance")** | Its first form ("Ending things with Sam") read as a claim on a suggestion card. The prompt forbids verdicts; the mock should not model one. | Connector phrases. |

## 3. Files and modules

```
src/domain/journeys/
  thresholds.ts ★        every number: weights, AUTO_ASSIGN 0.70, PENDING 0.50, CLUSTER_MIN 0.60, SUGGEST_MIN 0.25, spans, windows, core share
  affinity.ts ★          ObjectFeatures/JourneyFeatures → score, signals, available, reasons; tokenize; pairAffinity; decideAssignment
  cluster.ts ★           discoverClusters (two passes, greedy cliques, dismissed sets), classifyCluster
  progression.ts         themeProgression (adaptive buckets, top 2, collapse, min support 2)
  symbols.ts             recurringSymbols (deck-native card/suit/theme recurrence with context + sources)
  narrative.ts           narrativeHeader (honest counts)
  timeline.ts            TimelineEntry union, buildTimeline, isOpenLoop
  titles.ts              placeholderTitle, clip, JOURNEY_TITLE_MAX
src/journeys/ ★
  features.ts            loadReadingFeatures: fixed-query feature loading (auto+user mentions, themes, questions)
  assign.ts              assignReading: growable = active/dormant; never re-decides an existing row
  discover.ts            discoverJourneys: pool, suggested sets, grow/promote/skip/create
  refresh.ts             refreshJourney: activity, active⇄dormant, suggested→active, progression rows; journeysOfReadings
  materialize.ts         materializeJourneysForReading (flag gate → assign → discover → refresh → enqueue naming); the safe wrapper the memory materialiser calls
  propose.ts             runProposeJourney (consent + flag + pin gates, minimum context, low-confidence keeps placeholder, racing rename wins)
src/ai/tasks/propose_journey/ ★  prompt.ts, schema.ts (journey_proposal/1.0.0), version.ts, index.ts, mock.ts, fixtures/ (3 + baselines)
src/ai/index.ts          task registered
src/jobs/handlers/       payloads.ts (+proposeJourneyPayload), propose-journey.ts (lazy), index.ts
src/memory/candidates.ts loadJourneyLinks; CandidateSet.journeysExist; journeyIds per entity
src/memory/materialize.ts  journey signal passed to resolveMention; journey step after entities
src/domain/entities/resolve.ts  journeyOverlap null when either side is in no journey
src/db/schema/journeys.ts ★, migrations/0008_journeys.sql ★  (tables, RLS, triggers, search_readings(journey_id), merge/undo/split)
src/db/queries/journeys.ts ★  list/get/reading memberships + every user write
src/db/queries/journal.ts   journey_id → search_readings; ITEM_SELECT/toItem exported
src/domain/journal/filters.ts  journey key
src/domain/privacy/deletionRegistry.ts, src/privacy/purge.ts (+refresh after purge), src/privacy/aiArtifacts.ts
src/domain/export/schema.ts (export/1.2.0), src/export/build.ts (journeys.json, journey_members.json, 5 link kinds)
src/observability/logger.ts  'journeys' namespace, journeyId/state props
app/(app)/journey/       page.tsx ★ (list), actions.ts ★, suggested-card.tsx, new-journey.tsx, [id]/page.tsx ★, [id]/controls.tsx ★
app/(app)/reading/[id]/journey-panel.tsx ★, page.tsx (journeys slot); src/ui/components/reading-detail.tsx (slot)
app/(app)/home/page.tsx  suggestion card; app/(app)/journal/{page,filters}.tsx  Journey select; profile/privacy-controls.tsx copy
src/ui/components/journey-timeline.tsx, theme-progression.tsx, recurring-symbols.tsx
scripts/seed-demo-journeys.ts ★, seed-demo.ts (registered), seed-demo-readings.ts (notes enriched, one Thoth relationship reading, conference RWS), eval.ts (propose section)
fixtures/history/journeys/journey-arcs.json ★  (the entity arcs' folder is scanned flat; subfolder on purpose)
e2e/journeys.spec.ts ★, e2e/_helpers.ts (journeys flag, enqueueExtractions), e2e/journal.spec.ts (1.2.0)
Tests: src/domain/journeys/__tests__/{affinity,cluster,derived}.test.ts, src/journeys/__tests__/journeys.integration.test.ts,
  src/db/__tests__/journeys.rls.test.ts, invariants extended (model-cannot-create-confirmed-fact +1, opening-reading-makes-no-ai-call,
  deleting-reading-purges-derived ×2, raw-text-never-overwritten, deletion-registry), export.integration, resolve.test (3 variants), simulate.ts
```

## 4. Database changes

`0008_journeys.sql` (`drizzle-kit generate --name journeys`, hand-written after the marker), applied
on the local database:

- Tables: `journeys` (24 cols; checks on confidence and `merged_into_id ⇒ status = 'closed'`; index
  `(user_id, status, last_activity_at desc)`), `journey_members` (checks on object_type, state,
  confidence; unique `(journey_id, object_type, object_id)`; indexes on object and user),
  `journey_theme_progression` (checks `cardinality(source_object_ids) ≥ 1` and period order; unique
  `(journey_id, sequence_index)`). RLS enabled on all three with four policies each; members require
  the journey and (for readings) the reading to be the caller's; progression requires the journey.
- Triggers: `set_updated_at` on `journeys` and `journey_members`.
- Functions: `apply_journey_merge(uuid, uuid)`, `undo_journey_merge(uuid)`, `apply_journey_split(uuid,
  text, uuid[]) → uuid` — SECURITY INVOKER, granted to `authenticated, service_role`;
  `search_readings(p)` replaced with the `journey_id` filter (the `WHERE r.deleted_at IS NULL` guard
  kept; `0008` added to the invariant's scan). A `SELECT extensions.similarity(...)` precedes the
  function so the session has pg_trgm's GUC loaded — a migration with no trigram index of its own is
  otherwise refused `SET pg_trgm.word_similarity_threshold` on Supabase's non-superuser role.
- Deletion registry: `reading` root + `journey_members` (job); `journey` root populated (cascade);
  `user` root + three tables. `check-deletion-registry` fired for all three before registration.
- DATA_MODEL.md's Phase 07 section rewritten to the built shape (state column, title provenance,
  merge snapshot, functions).

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|
| `propose_journey` | `propose_journey/1.0.0` | `journey_proposal/1.0.0` | standard | New. Title (2–6 plain words, no card names, no verdict), one-sentence rationale, confidence *band* (`low` keeps the placeholder). Minimum context (§11): dates, questions, entities from `entityContextForObjects` (auto + user), theme labels — never notes. `maxTokens` 200. Mock: subject + strongest theme ("Maya and distance"). |

Eval (`pnpm eval --dry`, mock — no keys anywhere): 3 fixtures, every check green (schema, title
shape, no card name, names the subject, no prediction words, confidence band, one-sentence
rationale). Baselines in `src/ai/tasks/propose_journey/fixtures/__baselines__/` with empty
`human_review`. **The real-model run and the human read are owner tasks** (deferred, as in 04/06).

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `WEIGHTS` | `domain/journeys/thresholds.ts` | 0.35 / 0.25 / 0.20 / 0.10 / 0.10 | as written; sum to 1 (asserted); semantic renormalised out until 09 |
| `AUTO_ASSIGN` / `PENDING` | same | 0.70 / 0.50 | as written; boundary tests at ±0.001; entity-only = 0.60 → pending (fixture `n3`) |
| `CLUSTER_MIN_AFFINITY` / `CLUSTER_MIN_OBJECTS` / `CLUSTER_MIN_SPAN_DAYS` | same | 0.60 / 3 / 14 | as written; `cluster.test.ts` creates at exactly 3 objects / 14 days and not at 2 / 13 |
| `SUGGEST_MIN_AFFINITY` | same | **0.25** | new: about half the theme weight in common while active (`(0.20·0.5 + 0.10)/0.75 ≈ 0.27`); a diluted health/stability pair scores 0.296 (demo) and a single shared theme never clusters |
| `CORE_ENTITY_SHARE` | same | **0.5** | a majority; at ⅓ every passing name in a 3-member journey was core and pulled unrelated readings in (demo run 1) |
| `ACTIVE_WINDOW_DAYS` / `ACTIVE_DECAY_DAYS` | same | 60 / 120 | "active in last 60 days" as written; linear decay so a 100-day gap still counts 0.67 |
| `DORMANT_AFTER_DAYS` | same | 120 | new; active ⇄ dormant in `refreshJourney` |
| `PROGRESSION_MIN_SUPPORT` / `PROGRESSION_THEMES_PER_BUCKET` / `PROGRESSION_DENSE_PER_WEEK` | same | 2 / 2 / 1.5 | as written (FR-17: "<2 supporting objects not shown", "top 1–2 themes", weekly if dense) |
| `RECURRENCE_MIN` | same | 2 | a symbol recurs at two readings |
| `DISCOVERY_MAX_OBJECTS` | same | 200 | pairwise is quadratic; 200² scores in well under a second |
| Journey overlap in entity resolution | `domain/entities/resolve.ts` | null when either side is in no journey | see decision 8; `resolve.test.ts` three variants |

ALGORITHMS.md §2 rewritten to match (overlap coefficient, directional theme overlap, two passes,
grow/promote, status upkeep, progression and symbols).

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/journeys/__tests__/affinity.test.ts` (9) | weights sum to 1 and semantic is renormalised out until vectors exist; entity overlap is the coefficient against the core (Maya+Sam vs core Maya = 1, Sam alone = 0, passing mention not core); directional theme overlap arithmetic; question token Jaccard (1.0 for "Take the Lisbon job?" vs "Should I take the job in Lisbon?"); temporal window/decay at the exact days; `decideAssignment` at 0.70/0.699/0.50/0.499; entity+activity = exactly 0.60 → pending, +theme → auto, themes-only → none; pair symmetry; reasons without numbers; the fixture arc's four assignments |
| unit | `cluster.test.ts` (7) | the arc yields exactly {Maya ×3 active, agency ×3 active, health pair suggested}, r5 in none; active at exactly 3 objects / 14 days and not 2 / 13; entity or theme pair required; a diluted theme pair clears the suggestion floor, a lone theme never, an old pair never; clique growth against every member; dismissed sets not re-suggested unless new evidence; placeholder titles |
| unit | `derived.test.ts` (9) | bucketing by density; collapse across months with all sources kept and correct period bounds; <2 support dropped; top-2 per bucket; card recurrence with "twice in the outcome position" context and newest-first sources; **Thoth Lust and RWS Strength stay two symbols, Disks are not Pentacles, nothing mentions archetypes**; theme recurrence across decks; the header's honest wording; interleaved timeline order and month groups; open-loop rule |
| unit | `domain/entities/__tests__/resolve.test.ts` (35: arcs × 3 journey variants) | every `fixtures/history/` arc decides the same under no journeys, a shared journey (a tentative may lift to auto, same entity) and journeys elsewhere; the signal is unavailable without data on one side |
| unit (invariant) | `model-cannot-create-confirmed-fact` (+1), `opening-reading-makes-no-ai-call` (+journey entry points; `propose.ts` and its handler unreachable), `deleting-reading-purges-derived` (+`journey_members` job target, 0008 scan), `raw-text-never-overwritten` (+`src/journeys`), `deletion-registry` (+3), `journal filters` (+journey) | see below |
| integration | `journeys/__tests__/journeys.integration.test.ts` (7) | third Maya reading across 14 days → one `active`, `created_by: 'rule'`, placeholder "Maya", three `auto` members, naming job queued not run; `runBatch` names it (title, `model_id`, versions, rationale, `ai_calls`); a fourth entity-only reading → `pending` with reasons; detail keeps pending apart, progression steps have ≥ 2 sources, mixed decks; accepting the question makes the journal filter find it. Rename pins: a later proposal is `skipped`; a proposal racing a rename is `kept / renamed_meanwhile`. Merge moves and dedupes, closes the source with `merged_into`, undo restores exactly; split moves a confirmed member to a user journey, refuses moving all, the reading is untouched. A removed member stays `removed` through `materializeReading` + the journey step; restore puts it back. A dismissed suggestion is not re-created; a third reading is; accepting sets active/accepted/confirmed. Purge removes the membership and every progression step drops the source. **100 members: `getJourney` in ≤ 5 PostgREST requests, < 5 s, every card under its member's deck.** |
| integration | `deleting-reading-purges-derived.integration` (+journey), `export.integration` (+journeys.json nested progression, members, links, 1.2.0, deleted member excluded) | |
| rls | `db/__tests__/journeys.rls.test.ts` (5) | isolation on all three tables; B cannot add a member to A's journey nor file A's reading; state check `23514`; B cannot write or read A's progression; a step without evidence is `23514`; merge/undo/split refuse other users' journeys (`P0002`) and anon; as A merge works and undo restores; `search_readings(journey_id)` returns only the caller's rows |
| e2e | `e2e/journeys.spec.ts` (2 × 2) | **390 px + desktop:** five seeded readings (three about Maya, one Thoth; two health) → the cron extracts and gathers → Home shows the one suggestion → `/journey` axe-clean → open the Maya journey → header "3 readings and no confirmed outcomes yet … across both decks" → timeline: month headings, 3 items, the Thoth item shows *Lust* and *Thoth* and never *Strength* → progression sentence + a step opens to a reading link → symbols: *Strength · Rider…* "Appeared in 2 of 3 readings" with two links, *Lust* absent → axe → reading detail shows "suggested" membership → accept the suggestion (moves to Ongoing) → rename → `runJobs()` → reload: still yours → remove a member (2 readings) → Undo (3). **Flag off:** nothing gathers; a journey can be started by hand and shows the empty header. |

Invariant tests touched this phase (none newly unskipped — the ledger's next ones belong to 08):
- [x] `model-cannot-create-confirmed-fact` — case 5: `journeys.user_confirmed` defaults false (schema + migration), the member state check exists, rule code never writes `confirmed` / `user` / `userConfirmed: true`, the namer writes only where `title_source <> 'user'`.
- [x] `opening-reading-makes-no-ai-call` — journey pages, actions, query layer, `src/journeys/{materialize,refresh,assign,discover}` on the graph and AI-free; `src/journeys/propose.ts` and the handler unreachable; the registry imports it lazily only.
- [x] `deleting-reading-purges-derived` — `journey_members` is a job target with a counter and remover; `0008` keeps `WHERE r.deleted_at IS NULL`; integration: a reading in a journey purges to zero and the receipt counts it.
- [x] `raw-text-never-overwritten` — `src/journeys` never writes `readings`.

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  47 passed | 4 skipped (51)
      Tests  338 passed | 4 skipped (342)          (unit)
 Test Files  16 passed (16)
      Tests  101 passed (101)                      (integration, 37 s)

$ pnpm test:rls
 Test Files  10 passed (10)
      Tests  41 passed (41)

$ pnpm build && pnpm check:client-bundle && pnpm check:prompt-versions
 ✓ Compiled successfully in 5.6s
├ ƒ /journey 4.26 kB (119 kB) · /journey/[id] 5.65 kB (197 kB)
check-client-bundle: ok (68 files scanned)
check-prompt-versions: ok

$ pnpm test:e2e            (mobile 390×844 + desktop, fresh `next start`)
  118 passed (2.2m)        — the first full run had 2 failures: journal.spec pinned the export
                             version to 1.1.0; updated to 1.2.0 (journeys.spec: 4 passed, 9.2 s)

$ pnpm db:migrate  →  migrations applied
$ curl localhost:3100/api/health  →  {"status":"ok","db":true,"migration":{"current":true,"expected":"0008_journeys"},…}
$ pnpm demo:seed   →  23 readings extracted, 8 entities found, corrections applied
                      5 journeys gathered, 5 named by the mock, one renamed by the user
$ pnpm eval --dry  →  propose ✓ partner-named "Maya and distance" (high) · theme-only-pair "Health and stability" (medium) · workplace "The agency and decision" (high)
```

Registry gate fired for the three tables before they were registered:
```
Deletion registry is missing user-owned table(s): journey_members, journey_theme_progression, journeys
```

Demo database after `pnpm demo:seed` (the real pipeline over Ana's 23 readings; the seeder only
renames one journey):
```
Me and Maya [active, title by user]      Apr 11 rws auto 0.867 · May 16 rws auto 0.733 · Jun 5 thoth auto 0.867 · Aug 24 rws pending 0.578
                                          reasons: Every entry mentions Maya | The same themes run through all of them: Communication, Distance | It kept coming up over weeks, not days
                                          progression: communication (May–Jun, 2 sources)
The agency and ambition [active, model]   Apr 4 auto 0.809 · Apr 25 auto 0.900 · Aug 11 pending 0.636 · Aug 13 auto 0.762 · Sep 7 auto 0.756   (all RWS)
                                          progression: ambition → decision (April, 2 sources each)
Stability and health [suggested, model]   Jul 30 · Sep 10   (theme pair, 0.296)
Uncertainty and change [suggested]        Mar 19 · Jun 9 (thoth)
Sam and uncertainty [suggested]           Aug 11 · Aug 24   ("Every entry mentions Sam")
```

| Metric | Target | Measured |
|---|---|---|
| Auto-create at 3 objects / 14 days, not 2 / 13 | exact | unit-tested at the boundary; integration: third reading creates, two suggest |
| Entity-only reading vs an active journey | documented | 0.60 → pending (fixture and demo: two "Part of …?" questions) |
| Wrong confident memberships in the demo (read by hand) | 0 | 0 of 8 `auto` rows; both `pending` rows are honest questions (the Aug 11 "leaving the agency" note names the agency but is about leaving; Aug 24 names Maya after the break-up) |
| Model calls per reading opened / journey opened / user action | 0 | 0 (import-graph scan; the journeys e2e ledger shows only extraction + naming calls) |
| Model calls per journey created | 1 (job) | 1 `propose_journey` via the cron, gated on consent + flag |
| `getJourney` with 100 members | no N+1 | 5 PostgREST requests, 1.9 s including the test's 100 inserts; the read itself < 5 s asserted |
| Journey detail scroll, 100 members (desktop, `next start`) | smooth | not instrumented like the journal (no `content-visibility` needed at this size); timeline items are plain articles |
| Unit / integration / RLS / e2e | fast | 7 s / 37 s / 9 s / 2.3 min |

Manual checks actually performed:
- [x] **Read every membership in the demo journal** (query above): all eight `auto` rows are about the journey's subject; the two `pending` rows are exactly the ones a person would want to be asked about; the three suggestions are weak on purpose (a theme pair, a two-reading Sam mention) and read as "possibly".
- [x] **390 px screenshots, light + dark:** Home with the suggestion card; the Journeys list (suggestion → Ongoing → "2 more possible journeys will be offered one at a time" → *Start a journey yourself*); the Maya detail end to end (header, month-stuck timeline with Thoth and RWS items under their own names, "Might belong here" question, progression step, symbols, open loops, placeholders, disabled Ask, Manage); the reading detail's Journeys row in dark mode ("Part of Me and Maya?" with Yes/No above a "suggested" chip with why/keep/×).
- [x] **Keyboard:** every control is a native button, link, select, checkbox or `<details>` summary (44 px rows); the merge and delete confirmations are the Radix alert dialog; the e2e drives accept/rename/remove/undo through role queries.
- [x] **Screen reader:** the progression has a `sr-only` sentence ("The themes moved from communication."); membership inference is a word in text ("gathered here — suggested", "here because you said so", "you"); every action outcome is announced in a polite live region.
- [ ] **Comprehension check with an unfamiliar person** — not possible in this session (no second person). Owner task; record their answer verbatim below when done: *"…"*.

## 9. UX notes

Every section has a real empty state (see DESIGN_SYSTEM.md, Phase 07 paragraph). Inference is
always a word: the list says "gathered automatically" until the user touches a journey; the
timeline item says "gathered here — suggested" or "here because you said so"; the rename hint
says whether the title is a placeholder, a suggestion (with the model's rationale shown under
it) or yours. A suggestion is one dashed card, never a modal, never a badge count; dismissal
says "will not be offered again" and means it. Removal is one tap with an undo bar; every
destructive step names what stays ("the 3 readings stay exactly as they are").

Rough edges left deliberately: the progression is thin on the demo data (one or two steps) because
the mock extractor's themes are keyword-based; the "Merge into" select lists suggested journeys too
(harmless — merging accepts the target); the open-loops list says "Not resolved yet." for
partly-resolved readings; the reading detail's Journeys row sits inside Connections even when
extraction is off (the manual add is the point); `MemberControls` and the suggestion card are not
in `/dev/ui`.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Comprehension check: show the Journey screen to someone unfamiliar, record their answer verbatim | No second person in this session | owner (any time; write it into §8 above) |
| Real-model `pnpm eval` for `propose_journey`, human read of the three baselines, then `FLAG_JOURNEY_AUTOCREATE=true` | No provider key (as 04/06) | owner |
| `semantic_similarity` signal (0.25) | Needs retrieval-document vectors; renormalised out meanwhile | 09 |
| Life events and outcomes on the timeline; *Confirmed outcomes* and *Possible connections* sections | `TimelineEntry` union and the placeholders are ready | 08 |
| `journey_narrative` header and the progression's model labels | Deterministic header until then | 10 |
| Scoped "Ask about this journey" | Disabled button, labelled coming soon | 09 |
| Journey scroll instrumentation at 100+ members (the journal's 60 fps harness) | Integration test covers query count and time; visually smooth on the demo | 12 if a long journey feels slow |
| `MemberControls`, `SuggestedJourneyCard`, `JourneyPanel` in `/dev/ui` | Islands bound to actions, like `MemoryPanel` | 12 (gallery pass) |
| Bulk re-clustering when the user changes a theme correction on many readings | Each correction re-materialises its own reading (assignment + discovery run); nothing re-scores *existing* memberships by design | when asked |

## 11. Known issues and risks

- **Incremental vs batch discovery differ.** A user whose history is extracted in one batch (demo
  seed, `reprocess_extractions`) gets clusters over the whole history at once; a user writing day by
  day gets suggestions as pairs form and promotions as they grow. Both are correct under the
  algorithm, but the batch path surfaces more weak suggestions at once (the demo has three; the UI
  offers one at a time).
- **The mock extractor decides what can cluster.** Its keyword themes are sparse, so the demo
  notes were enriched with the words the rules catch ("distance", "conversation", "routine"). With
  the real model, theme overlap will be richer and the suggestion floor (0.25) may need raising —
  watch how many suggestions a real user gets per week before flipping the flag.
- **Assignment never re-scores existing rows** (by design, decision 6 of Phase 06 applied here):
  a reading filed `auto` stays filed if a later correction removes the shared entity. The user's
  one-tap remove is the correction path; a "re-evaluate memberships" job is a possible 12 item.
- **A reading can sit in a suggested journey and be `pending` in an active one** (demo: Aug 24).
  Both surfaces are honest; accepting the pending question does not remove it from the suggestion.
- `pnpm eval --dry` rewrites the other tasks' baselines' `ran_at`; those files were reverted so the
  diff carries only the new `propose_journey` baselines. (Do not `git stash -u` mid-phase with
  eval-touched baselines — restoring the tree cost a detour this session.)
- The two "Removed." helper texts (`MemberControls`' live-region message and the undo bar) both
  announce; screen readers hear the bar's sentence once and the polite status once.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste keys into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm eval --dry
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` → Home shows *Possibly a journey* →
   *Journey* tab: the suggestion, *Ongoing* (The agency and ambition · 1 to look at; Me and Maya ·
   1 to look at), *Start a journey yourself*.
2. Open *Me and Maya*: header "3 readings and no confirmed outcomes yet since April, across both
   decks. 3 readings are still open." → scroll the timeline (June: a Thoth reading with *Seven of
   Wands · The Magus · Eight of Swords*; May/April RWS) → *Might belong here*: "How are things
   really with M.?" → *Yes, part of this* → the header says 4 readings → Theme progression:
   *Communication* → tap it: two readings → Recurring symbols: *Communication*, *Distance* (themes)
   → Manage: rename to anything → reload: "Named by you." → remove a member → *Undo*.
3. Open the Aug 11 reading ("Is leaving the agency…"): Connections › Journeys shows "Part of
   The agency and ambition?" and a "suggested Sam and uncertainty" chip with *why?* → *No* on the
   question → the journey's timeline no longer offers it; *Add to a journey* → pick one.
4. Journal → Filters → *Journey* → pick *Me and Maya* → `journey=` in the URL.
5. Profile → *Delete AI artifacts*: the dialog counts "automatically gathered journeys"; confirm →
   *Me and Maya* (renamed) stays; the untouched suggestions go.
6. `pnpm jobs:run` after saving a reading that names Maya with a note about distance → within the
   minute it is filed or asked about; the journey's title job runs on the next batch.

## 13. Notes for the next phase

- **Timeline union:** `TimelineEntry` in `src/domain/journeys/timeline.ts` already has `event` and
  `outcome` members and `JourneyTimeline` renders them (`OtherEntry`); the detail page builds
  entries from `getJourney().members` — add event/outcome members to `journey_members`
  (`object_type` check already admits `life_event` and `outcome`) and to the query's read.
- **Members are polymorphic:** `journey_members.object_type` ∈ reading | life_event | outcome;
  RLS's `ownsObject` only checks readings today — extend the policy with an `exists` on
  `life_events` for `life_event` rows in the 08 migration (and the RLS test).
- **Features for events:** `loadReadingFeatures` is reading-only; give `ObjectFeatures.type =
  'life_event'` a loader over `life_events` + its `object_themes` / `entity_mentions`
  (`extract_event_metadata` writes the same tables), and call `assignReading`'s sibling for events.
- **`refreshJourney` is the single derived-rows hook** (activity, status, progression) — call it
  after any write that changes a journey's live members (outcomes attached, events added).
- **Sections to fill:** `app/(app)/journey/[id]/page.tsx` renders *Confirmed outcomes* and *Possible
  connections* as `<Empty>` placeholders in the right order; `narrativeHeader` takes
  `confirmedOutcomes` and `events` counts already.
- **Correlation input:** `journeysOfReadings()` (`src/journeys/refresh.ts`) gives the journeys a
  set of readings sit in — the journey-overlap signal for §3 correlation. `loadJourneyLinks()`
  in `memory/candidates.ts` gives entity ↔ journey membership.
- **Purge:** the reading purge refreshes affected journeys; the event purge must do the same
  (`journeysOfReadings` generalises by object type).
- **Prediction retraction and link re-scoring on merge/split** (deferred from 06) are still open
  for 08: `apply_journey_merge` moves member rows only.
- **Export:** `export/1.2.0`; `journeys.json` nests progression; adding events/outcomes/links
  bumps to 1.3.0.
- These notes were added to the Phase 08 file.
