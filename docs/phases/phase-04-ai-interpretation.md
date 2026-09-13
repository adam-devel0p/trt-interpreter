# Phase 04 — AI Boundary & Layered Interpretation

**Deps:** 03 · **Spec:** §9, §10, FR-06, FR-03B, FR-25, §13, §19 · **Outcome:** readings receive a streaming,
deck-aware, layered interpretation grounded in the Phase 02 reference data — versioned, cached, cost-
metered — and every provider failure mode leaves the reading intact and usable.

## Scope

**In:** real Anthropic provider, `interpret_reading`, `classify_safety`, `detect_repeat_question`,
`interpretations` + `ai_calls` + `safety_flags` tables, streaming UI, regeneration, thumbs feedback,
deck-purity enforcement, high-stakes handling, repeat-question nudge, cost telemetry, first evals.

**Out:** metadata extraction (06), embeddings (09) — note `detect_repeat_question` needs question
embeddings; implement a **minimal question-only embedding path** here and generalise it in 09.

## Tasks

From Phase 03 (see [completed/phase-03-report.md](completed/phase-03-report.md) §13):
- Read a reading through `getReading(client, id)` (`src/db/queries/readings.ts`) → `ReadingView`:
  the row plus `deck` (`DeckRow`), `spread` (`SpreadView` with `positions[].prompt`) and `cards[]`
  each carrying the **full deck-native reference row** (`card.name/title/keywords/meaning_upright/
  meaning_reversed/correspondences`), `orientation` and `position`. That is the whole interpretation
  input; never join the archetype tables.
- The detail screen is `src/ui/components/reading-detail.tsx` with an "AI interpretation" section
  that currently renders the "Not generated." slot inside the tinted AI container. Replace that
  slot with the streaming component; keep the section order (§6.3) and the container contract
  (DESIGN_SYSTEM → distinguishing user text from AI text). The "Your interpretation" editor above
  it is `UserNoteEditor`; the user's note is `reading.user_notes`.
- `opening-reading-makes-no-ai-call.test.tsx` stubs `@/ai`, `@/ai/index`, `@/ai/run` and
  `@/ai/providers/mock` to throw and scans the transitive import graph of `app/(app)/reading`,
  `app/(app)/home` and the reading queries/components for `src/ai/`. The interpretation must be
  triggered from a route handler / action that the **flow** calls after save, not from anything
  the detail page imports at render time; add the interpretations query to the fake-client test
  with a stored row and assert the same zero-call result.
- Every reading write in `app/(app)/reading/actions.ts` happens before, and independently of,
  anything you add. `saveReadingAction` returns `{ id }` and the flow navigates to
  `/reading/[id]?saved=1`; kick off interpretation from there (or from a `?saved=1` island), never
  from inside the save.
- `hasAiConsent(profile)` gates every call; the demo user `demo-ben@tarot.local` has consent off
  and `demo-ana@tarot.local` on, each with 20 seeded readings (`pnpm demo:seed`).
- Deck purity has a mechanical foothold already: `deck.system`, `card.suit_label`, `card.rank_label`
  and `card.name` on each `ReadingCardView` give you the allowed vocabulary; the other deck's
  names for the same slots come from the seed modules (`RWS_DECK` / `THOTH_DECK`) for the
  validator's banned list.
- `readings.metadata_version` bumps when cards are replaced (`replace_reading_cards`); an
  interpretation should record the version it was generated against so an edited reading shows
  its interpretation as stale rather than silently wrong.

### 1. Real provider
- `src/ai/providers/anthropic.ts` implementing `generateObject` + `generateStream` behind the policy
  already tested in Phase 00. Model IDs from env via `registry.ts`; no model ID in business code.
- Minimal OpenAI embeddings client for question similarity only, same adapter interface.
- Verify the circuit breaker, timeouts and repair path against the **real** provider once, manually.

### 2. Tables
`interpretations`, `ai_calls`, `safety_flags` per [../DATA_MODEL.md](../DATA_MODEL.md), RLS on the
user-owned ones. `interpretations.fact_status` fixed to `TAROT_INTERPRETATION` by check constraint.
`ai_calls` carries **no prompt or completion text** — assert with a test that inserts a call record and
greps the row for content.

### 3. `interpret_reading` (§9.3, §6.2 step 8)
- Input: question (or open-reflection framing), spread with position names **and position prompts**,
  deck system, each drawn card's **full reference row** from Phase 02, orientation, the user's
  "what I notice" note, and `ai_explanation_depth`/`experience_level`.
- Output schema *is* the layering: `synthesis` (one sentence), `per_card[] {position_index, card_id,
  text, nuances[]}`, `combined`, `reflective_prompts[]` (2–3).
- Prompt rules from [../AI_LAYER.md](../AI_LAYER.md#prompt-construction-rules-93): ground in supplied
  reference data, interpret in position, quote the user's words, hedged register, show plausible
  alternatives where symbolism is ambiguous, never contradict or replace the user's note.
- **Deck purity enforcement:** system prompt names the deck system and forbids substitution; a
  post-generation validator scans output for the *other* deck's names for the same archetypes and for
  wrong court terms (a Thoth reading mentioning "Page" or "Pentacles" fails). One retry, then fall back
  to reference-only display with an honest notice.
- **Experienced-user mode:** shorter AI output, user's note rendered above it (§9.3).
- Persist `model_id`, `prompt_version`, `schema_version`, tokens, cost, latency.

### 4. Streaming and caching
- `POST /api/readings/[id]/interpret` streams (SSE or Response stream). The reading already exists;
  this endpoint can fail freely without data loss.
- UI: skeleton immediately → synthesis appears first → per-card fills in → combined → prompts.
  Screen-reader-polite live region; cancellable; partial output preserved on disconnect and resumable.
- Cached permanently once `complete`. **Reopening never re-calls** (invariant test from Phase 03 now
  extended to cover a reading *with* an interpretation).
- Explicit "Regenerate" is user-initiated, metered, and supersedes rather than overwrites (keeps the
  old row for reproducibility).

### 5. Safety (§10)
- `classify_safety` runs on the question before interpretation: categories medical, self-harm, legal,
  financial, immediate-safety, none; with severity.
- On a hit: the reflection **still happens**; a calm, non-preachy card points to appropriate real-world
  help, shown once per reading, with region-appropriate resources where known. Never a refusal to read,
  never repeated lecturing (§10, and the copy rules in
  [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md#copy-rules)).
- Recorded in `safety_flags` with no journal text — category and IDs only.

### 6. Repeated-question handling (FR-25, §10)
Per [../ALGORITHMS.md](../ALGORITHMS.md#5-repeated-question-detection-fr-25-10): cosine ≥ 0.90 against
the last 24h and ≥ 2 prior asks → before drawing, surface the prior reading(s) and offer
"look at what's driving the uncertainty" alongside "draw anyway". One nudge per cluster per day.
Never block, never shame, never gamify.

### 7. Cost & telemetry (§13)
- Every call recorded in `ai_calls`; a dev-only `/dev/ai-usage` page shows calls, tokens, cost, p50/p95
  latency and error classes by task and model.
- Budget hook active (limits effectively infinite until Phase 11) — `budget_denied` path tested now.

### 8. Feedback
Thumbs up/down per interpretation plus an optional short reason (§16 AI quality). Stored without journal
text beyond the user's own typed reason, which is treated as journal content (not logged, not in
analytics props).

### 9. Evals
Register the first real eval suite (`pnpm eval`): fixtures per deck and spread asserting schema
validity, deck purity, hedged register (banned-phrase scan: percentages, "will happen", "definitely",
"the cards say you must"), positional specificity (per-card text references its position), and that the
user's note is acknowledged rather than contradicted. Baselines reviewed by a human.

## Test plan

- [ ] Unit: deck-purity validator (Thoth output containing "Pentacles"/"Page" → fail; correct Thoth
      output → pass); banned-phrase scanner; depth selection by profile.
- [ ] Integration with mock provider: happy path persists layered output with versions; **invalid JSON →
      repair → success**; second invalid → `failed` status and the reading remains fully usable;
      timeout → retry → tier downgrade → soft fail; 429 → backoff → breaker; refusal → honest terminal
      state; `budget_denied` → clear message, reading intact.
- [ ] **Invariant `reading-survives-ai-failure.test.ts` — unskip and pass** (every failure mode above
      leaves reading + cards + notes complete).
- [ ] **Invariant `opening-reading-makes-no-ai-call.test.ts`** extended to interpreted readings.
- [ ] **Invariant `model-cannot-create-confirmed-fact.test.ts` — unskip and pass:** `modelWrite()`
      rejects `CONFIRMED_FACT`; `interpretations` check constraint rejects any other status.
- [ ] `ai_calls` rows contain no prompt/completion text (row-level grep test).
- [ ] Repeat-question: 3 near-identical questions in an hour → nudge on the third, not the second;
      "draw anyway" works; nudge does not repeat same day.
- [ ] Safety: a self-harm-adjacent question still produces a reading **and** shows the resource card
      once; a benign question shows nothing.
- [ ] E2E at 390px: create reading → watch streaming interpretation → collapse/expand layers →
      reopen (no new call, verified by provider spy) → regenerate (one new call, old row retained).
- [ ] a11y: streaming output announced politely; expand/collapse keyboard-operable; AI container
      distinguishable without colour.
- [ ] `pnpm eval` run once against real models; results and any prompt iterations summarised in the report.

Manual:
- [ ] Read 5 interpretations across both decks. They must be specific to question and position, not
      fortune-cookie (§3.3, §9.3). If generic, iterate the prompt and bump `PROMPT_VERSION`.
- [ ] Run one Thoth reading and confirm zero RWS terminology anywhere on screen.
- [ ] Kill the provider key mid-flow; confirm the reading saves and shows a retry affordance.

## Exit criteria

- [ ] Layered, deck-aware, streaming interpretation persisted with model/prompt/schema versions.
- [ ] All five failure modes tested; content never lost.
- [ ] Deck purity enforced mechanically, not just prompted.
- [ ] Safety and repeat-question behaviours live and tested.
- [ ] `ai_calls` telemetry + `/dev/ai-usage`; no content in the table.
- [ ] Three invariant tests unskipped and passing.
- [ ] Eval suite registered, run once, baselines committed.
- [ ] Report (include example interpretations and the eval summary) + `../PROGRESS.md` + `../AI_LAYER.md`
      updated with final prompt/schema versions.
