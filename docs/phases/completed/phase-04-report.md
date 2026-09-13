# Phase 04 — Completion Report

**Status:** complete-with-deferrals
**Date:** 2026-09-13
**Phase file:** [../phase-04-ai-interpretation.md](../phase-04-ai-interpretation.md)

---

## 1. What was built

A saved reading now receives a **streaming, deck-aware, layered interpretation** — synthesis, card
by card in position, read together, questions to sit with — generated after the save from the
reading's own reference rows, persisted with model, prompt and schema versions, cached for good,
and never recomputed on open. The AI boundary is real: `src/ai/providers/anthropic.ts` (Messages
API with structured output, streaming, abort, content-free error mapping) and a plain-`fetch`
OpenAI embeddings adapter sit behind the Phase 00 runner, which gained `runStreamObject` — the
streaming face of the same repair / timeout-downgrade / backoff / breaker policy. Three tables
landed: `interpretations` (fact status fixed by check constraint, frozen once complete, one current
row per reading, regeneration supersedes), `safety_flags` (category and IDs, never text) and
`question_embeddings` (hash + pgvector), plus the service-role `ai_calls` ledger that `/dev/ai-usage`
reads. The run itself lives in `src/interpretation/service.ts`: consent gate → `pending` row →
`classify_safety` on the question → streamed `interpret_reading` with partial layers persisted →
`complete` or `failed` with a class, the reading untouched throughout. `POST
/api/readings/[id]/interpret` streams SSE (or returns the stored row as JSON with no call);
the detail page's `InterpretationPanel` island streams, polls, stops, retries, regenerates and
takes thumbs feedback; `LayeredInterpretation` renders the container contract with native
disclosure and a polite stage live region. Deck purity is enforced mechanically (validator +
one repair + honest `deck_purity` failure), the hedged register likewise, high-stakes questions
still get their reading plus one calm resource card, and the third near-identical question in a
day gets one nudge before drawing. Three invariants are live: `model-cannot-create-confirmed-fact`,
`reading-survives-ai-failure`, and `opening-reading-makes-no-ai-call` extended to readings with
stored interpretations. `pnpm eval` is a real runner (four reading fixtures, seven safety
questions, seven mechanical checks, baselines with a human-review block) — run against the mock;
**no provider key was available in this session**, so the real-model run, the manual reading of
five interpretations and the mid-flow key-kill check are deferred to the owner (§10).

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Streaming goes through a new `runStreamObject` with the full Phase 00 policy**, not the bare `runStream` | The phase requires repair, timeout/downgrade, backoff and breaker for the interpretation, *and* streaming. The bare stream had no policy; a non-streamed `runObject` had no UX. The new runner accumulates the stream, parses + schema-checks + `validate()`s at `done`, and treats any failure there exactly like invalid output (one repair turn echoing the failed text). Consumers get a `reset` event when an attempt is discarded. | Stream first, validate never; or generate the object non-streamed and fake the reveal. |
| **Deck purity is a validator on the runner, with an honest `deck_purity` failure class** | AI_LAYER rule 2 says "retry once, then drop to reference-only display". `validate()` returns content-free issue labels (`deck_purity:pentacles`); the repair hint names the offending terms; if the second attempt is still impure the row is `failed / deck_purity` and the UI says so, with the deck-native reference meanings below. | Silently stripping the offending words; storing impure text. |
| **Purity vocabulary excludes the other deck's small-card titles and matches single-word trumps case-sensitively** | The first cut banned every Thoth title in RWS readings — "Change", "Success", "Love", "Peace" are ordinary words and the mock output failed on "change". Titles are whitelisted for their own deck but never banned for the other; single-word trump names ("Justice", "Art", "Fortune") are banned only when capitalised, so "a sense of justice" passes and "Justice here suggests…" fails. Court and suit words are banned in any case. Proven by `purity.test.ts`. | Banning everything (unusable); banning nothing but suit/court (misses "The World" in a Thoth reading). |
| **The interpretation schema and the partial-JSON parser live in `src/domain/interpretation/`**, the task re-exports the schema | The UI (client bundle) and the query layer need the shape without importing `src/ai/` — the opening-reading invariant scans `layered-interpretation.tsx` and `interpretations.ts`. `domain/` is pure, so the client island can run the same tolerant parser the server uses. | Schema in `src/ai/tasks/…/schema.ts` imported by the UI (would fail the invariant). |
| **Streaming sends raw JSON text deltas; the client parses partial JSON** | One representation end to end, small frames, and "synthesis first → per card → combined → prompts" falls out of key order in the schema and the prompt. `partialInterpretation()` returns whatever has arrived, strings cut mid-sentence, rendered with a caret. | Server-side layer events (bigger frames, a second protocol to keep in sync). |
| **The `pending` row is written before the model is called; partial layers are persisted every 1.2 s into the layer columns** | "Partial output preserved on disconnect and resumable" without an extra column: while `streaming`, `synthesis / per_card / combined / reflective_prompts` hold the partial object. A `complete` row is then frozen by a DB trigger (`interpretations_freeze_complete`, `23514`), so "cached permanently" is a property of the data. | A separate `partial_text` column; freezing in code only. |
| **Regeneration inserts a new row and supersedes the old one at completion time** — the old row stays current until the new one completes | Partial unique index `(reading_id) where status='complete' and superseded_by is null`. If a regeneration fails, the previous interpretation is still the current one and the UI shows the failure as a note above it. Every generation stays reproducible (§9.4). | Overwriting; superseding at start (a failed regeneration would leave no current row). |
| **Consent is checked by the page, the route and the service** | The panel never fetches without consent (and says so with a link to Profile), the route returns 403, and the service yields `failed / consent` without a row. `demo-ben` (consent off) shows the honest slot. | One check at the edge. |
| **The run is kept alive with `after()` and published to an in-process live registry** | A client that disconnects mid-stream must not abort the generation (persistence is the truth); a client that reconnects to the same instance gets buffered events replayed then the live tail; any other instance polls `GET` every 2 s. `DELETE` cancels explicitly (`failed / cancelled`, partial layers kept). | Tying the run to the response stream; a queue job for interpretation (adds latency to the first-reading moment). |
| **The safety resource card is persistent on that reading, never repeated across readings** | §10 "shown once per reading … never repeated lecturing": one `safety_flags` row per (object, category) by unique index; the card renders whenever that reading opens, and no other reading inherits it. Categories `self_harm` / `immediate_safety` surface at any severity; `medical` / `legal` / `financial` from `medium`. | A dismissable banner (loses the resource when it might matter); showing it once ever. |
| **The mock provider reports `mock/<routed id>` as `model_id`** | A stored interpretation or `ai_calls` row must never claim `claude-opus-5` ran when the mock answered; found by reading the "Why am I seeing this?" line on a dev screenshot. | Keeping the routed id (misleading in dev and on the usage page). |
| **Repeat detection stores one `question_embeddings` row per ask, linked to the reading on save by a hash of the normalised question** | The ask happens before the reading exists; the save action (which may not import `src/ai/`) links by hash with a plain query. Only asks that became readings count toward the "≥ 2 prior" rule; any similar ask in the window with `nudge_shown_at` set means "nudged today". | Embedding at save time from the interpret route (misses non-interpreted readings; duplicates the call). |
| **`effort: 'medium'` for the deep and standard tiers, never for fast** | Opus 5 thinks by default; `medium` keeps the pause before the first token short for a streaming UX while retaining reasoning. Haiku 4.5 rejects `effort`. | Default `high` (longer first-token latency); no thinking. |
| **Tests that need the seed decks or the mock live in `src/interpretation/__tests__/`** | The layering lint (`domain/` may not import `db/` or `ai/`; `ai/` may not import `db/`) applies to test files too. | Relaxing the lint for tests. |

## 3. Files and modules

```
src/domain/
  facts/writeGate.ts ★             MODEL_ALLOWED, modelWrite() / userWrite(), WriteGateError
  decks/purity.ts ★                deckVocabulary, bannedTerms (identifying vocabulary − own), findPurityViolations
  interpretation/schema.ts ★       modelInterpretationSchema (what the model writes), interpretationOutputSchema (+card_id), statuses, error classes
  interpretation/partialJson.ts ★  tolerant JSON-prefix parser, partialInterpretation()
  interpretation/register.ts       banned-phrase scanner (percentages, "will happen", "you must", …), hedgeCount
  interpretation/depth.ts          selectDepth(profile) → sentences guidance, maxTokens, collapsedByDefault
  interpretation/repeat.ts         cosineSimilarity, decideRepeat (0.90 / 24h / ≥2 / once a day), normaliseQuestion
  safety/categories.ts             categories, severities, Zod schema, SAFETY_COPY, shouldSurface

src/ai/
  run.ts ★                         + runStreamObject (StreamObjectRequest: schema, validate, repairHint) with the full policy; parseJsonDocument
  types.ts                         StreamRequest.schema, mockInput hints
  pricing.ts                       micro-dollars per token by model prefix; costMicros()
  telemetry.ts ★                   DbTelemetry (writes ai_calls via @/db/admin), MultiTelemetry
  index.ts ★                       getAiRunner() (anthropic | mock), getEmbedder(), mockFixtures(), taskVersions(), describeProviderConfig(+embeddings)
  providers/anthropic.ts ★         SDK client, generateObject (output_config.format), generateStream, error mapping, effort by tier
  providers/openai-embeddings.ts   fetch adapter for /v1/embeddings
  providers/outputSchema.ts        Zod → structured-output JSON schema (constraints stripped)
  providers/mock.ts                function fixtures, chunked object streaming, invalid_json stream fault, 1536-d hashed embeddings, `mock/` model ids
  tasks/interpret_reading/{prompt,schema,version,index,mock}.ts ★  system + user prompts, validator, repair hint, resolveCardIds, mock generator
  tasks/interpret_reading/fixtures/*.json + __baselines__/
  tasks/classify_safety/{prompt,schema,version,index,mock}.ts + fixtures/questions.json
  tasks/detect_repeat_question/{index,version}.ts

src/interpretation/ ★  (orchestration; may import db and ai)
  service.ts ★                     runInterpretation(): consent → pending → safety → stream → complete/failed
  store.ts                         InterpretationStore seam (dbStore); has no path to readings
  live.ts                          in-process run registry: registerRun / publish / subscribe (replay + tail) / cancelRun
  events.ts, copy.ts               ServiceEvent union; failure copy
  input.ts                         ReadingView → InterpretReadingInput (orientation-correct keywords/meaning), depthFor
  vocabulary.ts                    bannedTermsFor(system) from the seed decks, forbiddenTermsSample
  repeat.ts                        checkRepeatQuestion(): embed → priors → verdict → record ask

src/db/
  schema/ai.ts ★                   interpretations, safety_flags, question_embeddings, ai_calls (+ enums)
  migrations/0005_ai_interpretation.sql ★  generated DDL + freeze trigger + comments
  queries/interpretations.ts ★     state/get/createPending/updatePartial/complete(supersede)/fail/feedback; safety flags; question asks
  queries/readings.ts              + listReadingSummariesByIds
  admin/index.ts                   + insertAiCall, aiUsageSince, recentAiCalls

app/
  api/readings/[id]/interpret/route.ts ★   GET state · POST start/attach/stored (SSE or JSON) · DELETE cancel
  api/readings/repeat-check/route.ts       FR-25 check, consent-gated, fails soft
  (app)/reading/[id]/interpretation-panel.tsx ★  client island (off / idle / streaming / in_progress / failed / stored), Feedback
  (app)/reading/[id]/page.tsx              loads profile + interpretation state + flags; passes the `interpretation` slot
  (app)/reading/actions.ts                 setInterpretationFeedbackAction; linkQuestionAsk on save
  (app)/reading/new/reading-flow.tsx       question step: repeat check on Continue, nudge region, "Draw anyway"
  (app)/reading/new/page.tsx               repeatCheck = consent
  dev/ai-usage/page.tsx                    cost/latency/error ledger by task and model

src/ui/components/
  layered-interpretation.tsx ★     the AI container contract, layers as <details>, stage live region, stale notice, why-this
  safety-resource-card.tsx         §10 card
  reading-detail.tsx               `interpretation` slot (fallback "Not generated.")

scripts/
  eval.ts ★                        real eval runner (--dry for mock); baselines with human_review
  seed-demo-interpretations.ts     stored interpretations for demo-ana (consent on) via the write gate
  seed-demo.ts                     registers the seeder

Tests (see §7): src/ai/__tests__/{runStreamObject,anthropic,openai-embeddings}.test.ts,
  src/domain/{interpretation,facts,safety}/__tests__/*, src/interpretation/__tests__/{purity,interpret_reading,repeat-rule}.test.ts,
  src/interpretation/__tests__/interpretation.integration.test.ts, src/db/__tests__/ai.rls.test.ts,
  src/__tests__/invariants/{model-cannot-create-confirmed-fact,reading-survives-ai-failure}.test.ts (unskipped),
  opening-reading-makes-no-ai-call.test.tsx (extended), src/__tests__/fixtures/{reading,memoryStore}.ts,
  e2e/interpretation.spec.ts, e2e/smoke.spec.ts (+/dev/ai-usage), e2e/reading.spec.ts (consent-off copy)
```

## 4. Database changes

`0005_ai_interpretation.sql` (`drizzle-kit generate --name ai_interpretation`, hand-written after
the marker):

- Enums `interpretation_status`, `ai_call_status`.
- `interpretations` (26 columns; checks `interpretations_fact_status_check`
  (`= 'TAROT_INTERPRETATION'`), `interpretations_feedback_check` (`null | -1 | 1`),
  `interpretations_complete_check` (a complete row has every layer + `model_id`); FKs
  `reading_id` cascade, `user_id` cascade; **partial unique** `interpretations_current_idx`
  `(reading_id) where status='complete' and superseded_by is null`; indexes `(reading_id,
  created_at desc)`, `(user_id, created_at desc)`; four policies, insert/update additionally
  `exists (select 1 from readings r where r.id = reading_id and r.user_id = auth.uid())`).
- `safety_flags` (9 columns; category/severity checks; unique `(object_type, object_id,
  category)`; four policies).
- `question_embeddings` (8 columns incl. `vector vector(1536)`; indexes `(user_id, asked_at
  desc)`, `(user_id, question_hash)`; four policies, update additionally checks the parent when
  `reading_id` is set).
- `ai_calls` (15 columns; `user_id` FK `on delete set null`; indexes on `created_at`, `(task,
  created_at)`, `(user_id, created_at)`; RLS enabled, **no policies**).
- Hand-written: `interpretations_set_updated_at`; `interpretations_freeze_complete()` + trigger
  (a `complete` row's layers, versions, status, `metadata_version`, `reading_id` are immutable,
  `23514`); table comments.

DATA_MODEL.md rewritten for these four tables (columns, checks, index, trigger, enums, RLS
variants). Deletion registry: `interpretations` and `question_embeddings` cascade from the
reading and the user; `safety_flags` cascade from the user and are keyed by object id — the
**Phase 05 purge job must delete them with the reading**; `ai_calls` keeps rows with `user_id`
nulled. Integration setup truncates `ai_calls` between tests.

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|
| `interpret_reading` | `interpret_reading/1.0.0` | `interpretation/1.0.0` | deep (`effort: medium`) | System prompt per deck system + depth (+ high-stakes clause); user turn = question / open-reflection framing, life area, spread, each card's position prompt, deck-native identity, orientation-correct keywords + meaning, correspondences, the note verbatim, the forbidden-terms line. Output keys in layer order. Validator: position coverage, purity, register. |
| `classify_safety` | `classify_safety/1.0.0` | `safety_classification/1.0.0` | fast | Question only; 64 max tokens; failure → `none`. |
| `detect_repeat_question` | `detect_repeat_question/1.0.0` | `repeat_verdict/1.0.0` | embedding | No prompt; the rule is pure. |

Prompt iterations: none against a real model (no key). The mock fixture generator was tuned
once so its default output passes the validator for both decks (it only echoes the names it is
given). Eval numbers: **dry run only** — `pnpm eval --dry`: classify_safety 7/7 categories
(keyword mock), all four interpretation fixtures pass the seven mechanical checks with
`attempts=1 resets=0`. Baselines in `fixtures/__baselines__/` are labelled `provider: "mock"`
and carry an empty `human_review` block; the real run replaces them.

Example (mock, Thoth · Past/Present/Future · experienced reader, folded by default):

> **Synthesis.** Taken together, these cards suggest that "What is this relationship asking of me
> right now?" may be less about a decision than about what Lust in the Past position is asking you
> to notice.
> **Past — Lust.** In the Past position, Lust may point to the rapture of vigour as one thread running
> through the question. One way to read this is as a question rather than an answer: what would the
> rapture of vigour look like here, in practice? *Read another way, Lust here might describe how the
> situation feels from the inside rather than what it is.*
> **Present — Three of Swords.** … may point to sorrow as one thread … *(nuance)*
> **Future — Princess of Cups.** … *(nuance)*
> **Read together.** Read as a whole, the Lust, Three of Swords, Princess of Cups seem to describe a
> movement from the rapture of vigour toward something you have not named yet. Your own note already
> touches this, and the cards mostly add texture to what you noticed. …
> **Questions to sit with.** What would change if you treated Lust as describing you rather than the
> situation? / Which of these cards felt truest the moment you saw it, before you read anything?

The mock is deliberately formulaic; its job is deck purity, register and shape, not insight.

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `REPEAT_SIMILARITY` / `REPEAT_WINDOW_MS` / `REPEAT_MIN_PRIOR` | `domain/interpretation/repeat.ts` | 0.90 / 24 h / 2 | ALGORITHMS §5; unit + integration tests (third ask nudges, not second) |
| `PARTIAL_FLUSH_MS` | `interpretation/service.ts` | 1 200 ms | one row update per ~1 s while streaming; tests use 0 |
| `IN_PROGRESS_FRESH_MS` | interpret route | 3 min | a `streaming` row older than this is treated as dead and a new run may start |
| `RETAIN_MS` (live registry) | `interpretation/live.ts` | 2 min | reconnect window after a run ends |
| `POLL_MS` | `interpretation-panel.tsx` | 2 000 ms | polling a run on another instance |
| `REPEAT_CHECK_TIMEOUT_MS` | `reading-flow.tsx` | 2 500 ms | the check never makes the person wait longer than this |
| Depth `maxTokens` | `domain/interpretation/depth.ts` | brief 1 100 · standard 1 800 · deep 2 800 | sized to the sentence guidance with headroom; real-model token counts to be recorded by the owner's eval run |
| `SYNTHESIS_MAX` / `NUANCES_MAX` / `PROMPTS_MIN–MAX` | `domain/interpretation/schema.ts` | 320 chars / 3 / 2–3 | phase file |
| `SAFETY_SURFACE_MIN` | `domain/safety/categories.ts` | self_harm, immediate_safety: low; medical, legal, financial: medium | §10 — never miss a crisis; do not lecture on a passing mention |
| Anthropic `effort` | `providers/anthropic.ts` | deep/standard `medium`, fast none | see §2 |
| Prices | `ai/pricing.ts` | opus-5 5/25 · sonnet-5 2/10 · haiku-4-5 1/5 · text-embedding-3-small 0.02 µ$/token | list prices at time of writing |

ALGORITHMS.md §5 updated with the implementation note.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `ai/__tests__/runStreamObject.test.ts` (12) | streamed deltas then the validated object with one telemetry row; invalid JSON → reset → repair → success with the failed text echoed; second invalid → `invalid_output` with issues; **validator failure counts as invalid output** (one repair with the hint), twice → failed with `issues`; timeout → retry → downgrade → fail (`deep, deep, standard`); downgraded attempt succeeds; 429 backoff `[750, 1500]` then success; 3×5xx → `provider_error`; breaker opens after five and short-circuits with zero calls; refusal terminal; budget denied before any call; stopping the consumer records nothing |
| unit | `ai/__tests__/anthropic.test.ts` (7) | against a fake SDK client: structured-output format, `effort` for deep not fast, abort signal passed, cost from usage; SDK errors → content-free classes (no message text leaks); refusal / max_tokens → terminal classes; stream deltas + done; refusal after the stream throws; no embeddings. `toOutputSchema` strips constraints and closes objects |
| unit | `ai/__tests__/openai-embeddings.test.ts` (3) | request shape, index order, pricing; 429/5xx/401 mapping; count mismatch |
| unit | `interpretation/__tests__/purity.test.ts` (7) | banned lists per deck; own terms never banned (Knight, Strength-as-title); titles never banned ("change", "success"); **Thoth output with Pentacles/Page fails, correct Thoth passes**; RWS with Disks/Prince fails; capitalised single-word trumps only; whole-word, case rules, en-dash |
| unit | `domain/interpretation/__tests__/register.test.ts` (2), `depth.test.ts` (3), `partialJson.test.ts` (5), `interpretation/__tests__/repeat-rule.test.ts` (6), `domain/facts/__tests__/writeGate.test.ts` (2), `domain/safety/__tests__/categories.test.ts` (3) | banned phrases and hedged prose; depth by profile incl. experienced shortening + folding; every prefix of a JSON document parses to a monotone subset, layers appear in order, preamble ignored, growing numbers withheld; cosine, third-not-second, 24 h window, unlinked asks ignored, once per day, different cluster; gate accepts/rejects; surface thresholds, calm copy, unknown category rejected |
| unit | `interpretation/__tests__/interpret_reading.test.ts` (11) | system prompt names the deck and forbids substitution, grounds in supplied text; user turn carries question, every position prompt, each card's reference row, the note verbatim, other-deck terms only in the "do not use" line; open-reflection framing; Thoth never "reversed"; depth/experienced/safety clauses; request shape; validator accepts the mock for both decks, flags Pentacles/Page by term, position coverage, predictive register; card ids resolved in order; safety request is tiny; mock classifier |
| unit (invariant) | `model-cannot-create-confirmed-fact.test.ts` (3) | see below |
| unit (invariant) | `reading-survives-ai-failure.test.ts` (10) | see below |
| unit (invariant) | `opening-reading-makes-no-ai-call.test.tsx` (5, +2) | import graph now also covers `layered-interpretation.tsx`, `safety-resource-card.tsx`, `queries/interpretations.ts`, `queries/profile.ts`; reading a stored interpretation is one select on `interpretations`, no RPC, spy never called; a reading **with** a stored interpretation renders every layer, "suggested", the model id, no "Not generated.", no RWS terms for Thoth |
| integration | `interpretation/__tests__/interpretation.integration.test.ts` (9) | happy path persists layered output with versions, `metadata_version`, card ids, tokens; `ai_calls` has one `ok` row per task carrying only identifiers/versions/timestamps (every string value matches `^[\w\-./:+@]+$`); **complete row frozen (`23514`)**, duplicate current refused (`23505`), regeneration supersedes and keeps the old text; **fact_status constraint refuses CONFIRMED_FACT / USER_REFLECTION / INFERRED_EVENT**; invalid ×2 / refusal / timeout ×3 → failed row, reading byte-identical, `ai_calls` status matches; budget denied → no call; self-harm question → complete + one content-free flag, idempotent, benign → none; Thoth reading completes with no RWS vocabulary; feedback round-trip; **repeat question through pgvector**: third ask nudges with both prior readings, fourth same day does not, different question does not, 1536-d vectors read back, 3 of 5 asks linked |
| rls | `db/__tests__/ai.rls.test.ts` (4) | `interpretations` isolation + B cannot attach to A's reading (own user_id) nor re-point; `safety_flags` isolation; `question_embeddings` isolation + B cannot link to A's reading; `ai_calls` invisible/unwritable to users and anon, service role writes |
| e2e | `e2e/interpretation.spec.ts` (4 × 2) | **streams after the save** (eyebrow, "suggested", stage live region reaches "Interpretation complete.", layers present, user's note above), axe; `ai_calls` = 1 interpret + 1 classify; **collapse/expand by keyboard**; **reopen → no new call** (ledger unchanged); feedback "Noted."; **regenerate → exactly one more call, two rows, old superseded and retained**; high-stakes question → reading + exactly one resource card with a helpline link, no refusal copy, axe, still one after reload; benign → none; **consent off → "AI interpretation is off.", zero calls**; **repeat: third ask nudges with two earlier readings, no shaming copy, axe, Draw anyway continues, fourth same-day ask does not nudge** |
| e2e | `smoke.spec.ts` (+1 × 2), `reading.spec.ts` (updated) | `/dev/ai-usage` renders the ledger, axe (scrollable tables focusable); the consent-off slot copy |

Invariant tests unskipped this phase:
- [x] `model-cannot-create-confirmed-fact.test.ts` — `modelWrite()` refuses `CONFIRMED_FACT` and
      `USER_REFLECTION` (also through a cast); every interpretation write the query layer sends
      carries `TAROT_INTERPRETATION` and never the string `CONFIRMED_FACT`; the Drizzle table
      declares `interpretations_fact_status_check` with the default, and the migration contains
      it; the live constraint is exercised in the integration suite.
- [x] `reading-survives-ai-failure.test.ts` — the store the service writes through has no method
      touching readings; happy path; invalid ×2, timeout → downgrade → timeout, 429 ×3, 5xx ×3,
      refusal, deck purity ×2, budget denied, circuit open, no consent, cancellation, self-harm —
      after each the reading is byte-identical, the row carries the class, the message says the
      reading is saved.
- [x] `opening-reading-makes-no-ai-call.test.tsx` — extended to interpreted readings (above).

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  33 passed | 8 skipped (41)
      Tests  243 passed | 8 skipped (251)          (unit)
 Test Files  7 passed (7)
      Tests  46 passed (46)                        (integration)

$ pnpm test:rls
 Test Files  7 passed (7)
      Tests  19 passed (19)

$ pnpm build && pnpm check:client-bundle && pnpm check:prompt-versions
 ✓ Compiled successfully in 4.8s
├ ƒ /api/readings/[id]/interpret · /api/readings/repeat-check · /dev/ai-usage · /reading/[id] 10.9 kB (164 kB)
check-client-bundle: ok (62 files scanned)
check-prompt-versions: ok

$ pnpm test:e2e            (mobile 390×844 + desktop)
  100 passed (1.4m)   — four consecutive full runs after the last code change: 100/100 each

$ pnpm db:migrate
migrations applied
$ curl localhost:3100/api/health
{"status":"ok","db":true,"migration":{"current":true,"expected":"0005_ai_interpretation",...},
 "provider":{"provider":"mock","configured":true,"routing":true,"embeddings":true}}

$ pnpm demo:seed
  40 readings across 2 users (6 months)
  20 interpretations for consenting demo users

$ pnpm eval --dry
eval · provider mock · interpret_reading/1.0.0 · interpretation/1.0.0
classify_safety: 7/7 categories correct
interpret ✓ rws-celtic-open                  attempts=1 resets=0 tokens=100/50 cost=$0.0000 2.8s
interpret ✓ rws-three-card-job               attempts=1 resets=0 …
interpret ✓ thoth-one-card-money             attempts=1 resets=0 …
interpret ✓ thoth-three-card-relationship    attempts=1 resets=0 …
eval: all mechanical checks passed — now read the baselines.
```

Database spot-check (psql in the Supabase container, after the gates + screenshots):
```
 interpretations: complete 82 (20 seeded + tests/e2e)   policies: 4 × interpretations, 4 × safety_flags, 4 × question_embeddings, 0 × ai_calls
 ai_calls: classify_safety ok · interpret_reading ok (status/model/task only — no text columns exist)
 safety_flags: self_harm/high × 10 (one per flagged reading)     question_embeddings: 63 asks, 54 linked to readings
 triggers on interpretations: interpretations_set_updated_at, interpretations_freeze_complete
```

| Metric | Target | Measured |
|---|---|---|
| Reopen a reading with an interpretation → model calls | 0 | 0 (e2e: `ai_calls` unchanged; unit: spy never called) |
| Regenerate → model calls | 1 | 1 interpret (+1 classify) |
| Streaming first layer visible (mock, 12 ms/chunk) | immediately after skeleton | synthesis within ~0.3 s of the save landing |
| Interpretation end to end with the mock | — | 1–2 s (e2e) |
| Unit / integration / RLS / e2e | fast | 5.2 s / 9.4 s / 6.8 s / ~84 s |
| `/reading/[id]` first-load JS | — | 164 kB (+13 kB for the panel) |
| Real-model latency, tokens, cost per depth | to record | **not measured — no key** (§10) |

Manual checks actually performed:
- [x] **390 px screenshots, light + dark** (streaming with caret, complete, feedback open, "Why am
      I seeing this?", safety card above the interpretation, consent-off slot, repeat nudge,
      `/dev/ai-usage`). Fixed from this review: the mock reporting `claude-opus-5` as the model,
      the doubled "Another way to read it: Read another way…" nuance prefix, the usage page's
      Date parameter crash, the nudge's earlier-reading links lacking a time, the usage tables
      not being keyboard-focusable (axe).
- [x] **Keyboard**: layers fold/unfold with Tab + Enter on native `<summary>` (e2e); feedback
      chips are buttons with `aria-pressed`; Stop / Try again / Regenerate are ≥ 44 px buttons.
- [x] **Screen reader**: `role="status" aria-live="polite"` announces stages, not tokens
      (asserted text in e2e); the container is distinguishable without colour (eyebrow "AI
      interpretation · suggested", sans face, left rule).
- [x] **Thoth reading with zero RWS terminology on screen** — the integration test asserts the
      stored row and the Phase 03 e2e still asserts the page body (`/Strength|Pentacles|Rider|Waite/`
      absent); with the mock the output is pure by construction. **Against the real model: not
      run** (§10).
- [ ] Read 5 real interpretations across both decks for specificity — **not possible without a key** (§10).
- [ ] Kill the provider key mid-flow — **not possible without a key**; the equivalent failure
      (provider error mid-stream) is covered by the invariant and integration tests: the reading
      saves and the panel shows "Interpretation unavailable — your reading is saved. Try again".

## 9. UX notes

States built for the AI section: **skeleton** (two pulsing lines under the eyebrow until the
first token), **streaming** (synthesis grows with a caret, cards fill in, "writing…" in the
eyebrow, stage announcements, Stop), **in progress elsewhere** (stored partial layers + "Writing
in the background — this page keeps up", polled), **empty** ("Not generated." + "Generate
interpretation" with a one-line explanation of what is sent; or, without consent, "AI
interpretation is off." + link to Profile), **error** ("Interpretation unavailable — your reading
is saved." + what happened + Try again; partial layers stay above it), **stored** (layers, a
*stale* notice when the cards changed since, feedback, Regenerate, "Why am I seeing this?").
The user's note keeps its serif-on-paper treatment above; for `experienced` readers every layer
but the synthesis starts folded.

Design system extended with `LayeredInterpretation`, `SafetyResourceCard`, the
`InterpretationPanel` island and the FR-25 nudge region (DESIGN_SYSTEM.md updated).

Rough edges left deliberately: the eyebrow repeats "AI interpretation" under the section
heading (it is the container's own label, needed when the container appears without the heading
in Phase 05's journal); the feedback reason field opens under the chips and pushes Regenerate to
the next line on narrow screens; the nudge's "Look at what's driving the uncertainty" opens the
most recent earlier reading rather than a dedicated reflection surface; `/dev/ai-usage` is a
plain table that scrolls horizontally at 390 px.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| **`pnpm eval` against the real model; human review of baselines; reading 5 real interpretations across both decks; the Thoth zero-RWS check against the real model; kill-the-key mid-flow; verifying breaker/timeout/repair against the real provider once** | No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in any environment this session. Everything is wired and tested against the mock and a fake SDK client; the runner refuses to run with `AI_PROVIDER=anthropic` and no key. | **owner**: set the keys in `.env.local`, `AI_PROVIDER=anthropic`, run `pnpm eval`, read `fixtures/__baselines__/*.json`, fill `human_review`, iterate the prompt (bump `PROMPT_VERSION`) if generic; then a real reading in the app |
| Real per-model token/cost/latency figures per depth | same | owner's eval run; `/dev/ai-usage` shows them |
| Recorded provider fixtures in `fixtures/decks/` | The mock's fixture functions answer for any reading; recorded responses would only be useful for regression on a specific real output — capture them from the first real eval run if wanted | 12 (optional) |
| Region-aware safety resources | `profiles.locale` is `en` for everyone and no region is known; the card shows the international line plus US/UK lines | 11/12 (with locale/timezone work) |
| Per-user budgets | `usage_counters` lands in 11; the `budget_denied` path is tested now | 11 (unchanged) |
| Purging `safety_flags` with a reading | keyed by object id, no FK; `via: 'job'` in the registry | 05 purge job |
| Interpretation in the journal list / export | Phase 05 surfaces; `getInterpretationState` and `LayeredInterpretation` are ready | 05 |

## 11. Known issues and risks

- **Prompt quality is unproven against a real model.** The prompt follows every AI_LAYER rule and
  the validator catches purity/register/coverage mechanically, but "specific, not fortune-cookie"
  (§3.3) needs the owner's eval run. Expect at least one `PROMPT_VERSION` bump.
- **Structured outputs + streaming**: `output_config.format` is sent on the streaming call; if
  the endpoint ever rejects it for a model, the provider would surface `unknown/http_400` and the
  UI a retry. Verify once with a key (a one-line fallback would be to drop `format` on streams
  and rely on the prompt + Zod).
- **Purity false positives**: a user's note quoted back by the model that happens to contain a
  banned word ("my friend Princess", "the Justice League") would fail validation, retry once and
  then show the honest `deck_purity` failure. Rare; noted for the eval review.
- **Clock skew**: once during a full e2e run and once during the screenshot session the route
  handler got `PGRST303` (a JWT "issued in the future" right after sign-in, Docker vs host
  clock). The repeat-check route now fails soft; pages that call `getProfile` right after sign-in
  could still 500 in that window. Pre-existing environment issue, not phase-specific.
- **Serverless lifetime**: the run continues after the client disconnects via `after()`; on
  Vercel this is bounded by the function's max duration. A 45 s deep call plus persistence fits;
  a downgrade chain (up to ~2 min worst case) might not. Watch `ai.interpretation.task_crashed`.
- **Live registry is per instance**: reconnecting on another instance falls back to 2 s polling
  of the stored partial layers — correct, just less smooth.
- **Mock model ids changed** to `mock/<id>`; rows written before this change (local dev DB
  only) still show the routed id on `/dev/ai-usage`.
- The reading-flow's question step now makes one network call on Continue for consenting users
  (bounded at 2.5 s, fails soft). With `AI_PROVIDER=anthropic` and no `OPENAI_API_KEY`,
  `getEmbedder()` throws `unsupported` inside the check → "no nudge", logged once per ask.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm eval --dry
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` (consent on) → open any reading from
   Home: the AI interpretation renders from its stored row (no call — check `/dev/ai-usage` does
   not grow). Fold/unfold the layers with the keyboard; try "Why am I seeing this?".
2. Start a reading → question → three physical cards → Save. Watch the synthesis appear, then
   cards, then "Read together" and the questions; press Stop mid-way once and see the partial text
   kept with "Stopped…" and Try again. Regenerate: a new interpretation, the old one superseded
   (`select status, superseded_by from interpretations where reading_id = …`).
3. Ask "Some days I want to end my life. Will it get better?" → the reading is still interpreted
   and one calm resource card sits above it. Reload: still one.
4. Ask "Will Sam call me back tonight?" three times (one-card readings): the third time the
   question step offers the two earlier readings and "Draw anyway". A fourth ask the same day
   does not nudge.
5. Sign in as `demo-ben@tarot.local` (consent off): the AI section says "AI interpretation is
   off." with a link to Profile and nothing is called.
6. With a key: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`, `OPENAI_API_KEY=…` → `pnpm eval`,
   then read `src/ai/tasks/interpret_reading/fixtures/__baselines__/*.json`.

## 13. Notes for the next phase

- **Reading an interpretation**: `getInterpretationState(client, readingId)` → `{ current,
  latest }`; render `current` with `LayeredInterpretation` (`layers` = the four columns,
  `cards` = position/name refs, `meta` for the why-line). Never call the model from a list or
  export path — the invariant scan will grow to cover the journal routes.
- **Deleting a reading** cascades `interpretations` and `question_embeddings`; `safety_flags`
  must be deleted by the purge job (`object_type='reading' and object_id=…`). Soft delete
  (`deleted_at`) is not consulted by `getInterpretationState` — filter on the reading side.
- **Editing cards** bumps `readings.metadata_version`; the panel then shows the stored
  interpretation as *stale* with "Generate for the current cards". Nothing else to do.
- Export (FR-23) should include interpretations (they are the user's derived artifacts) with
  their versions, and `feedback_reason` (the user's words).
- `runStreamObject` and `StreamObjectRequest` are the pattern for any future streamed structured
  task (`answer_from_evidence` in 09); `runObject` for the rest. Fixtures for the mock can be
  functions of `mockInput` — keep hints structural (ids, names, counts), never journal text.
- `ai_calls` is the provider spy for e2e; `MemoryTelemetry` for unit tests.
- Layering lint applies to tests: tests that need the seed decks or the mock live in
  `src/interpretation/__tests__/` (or another unrestricted folder), not under `src/domain/` or
  `src/ai/`.
- These notes were added to the Phase 05 file.
