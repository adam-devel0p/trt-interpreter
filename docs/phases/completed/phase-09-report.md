# Phase 09 — Completion Report

**Status:** complete with deferrals (the real-model runs of the two new tasks and the human read of their baselines are owner tasks, as every phase since 04; `build_retrieval_document` stays deterministic; the theme-only labelled pair still misses with mock vectors — see §10)
**Date:** 2026-09-14
**Phase file:** [../phase-09-retrieval-ask.md](../phase-09-retrieval-ask.md)

---

## 1. What was built

A person can now ask their own history a question in plain language and get an answer that
is grounded, bounded, cited and honest when the evidence is thin. Every live reading and life
event carries a **retrieval document** — a compact, deterministic template of the question or
sentence, derived labels, deck-native card names, canonical entity labels and the user's own
outcome, never the notes — and a vector of exactly that text, rebuilt through a deduped job
from the write paths that change it (save, extraction, correction, connection decision,
outcome) and backfilled otherwise. **Hybrid retrieval** runs all seven §8.1 steps: a fast
parse into hints, structured narrowing in a `SECURITY INVOKER` SQL function that filters by
`auth.uid()` on every branch, cosine over the narrowed set re-scored
`0.60·semantic + 0.20·structural + 0.15·recency + 0.05·links` (unavailable signals
renormalised out, the codebase's rule), augmentation with linked events and outcomes, a hard
bound of 24 whole objects / 6000 tokens with dropped ids recorded, a deep-tier
`answer_from_evidence` call with a citation-required schema, and a verifier that strips
unknown labels, asks for one repair and otherwise degrades to "not enough evidence" with
what *was* found. The **Ask screen** has the §6.6 example questions, scope chips (all
history · a journey · a person or place · a date range), a stage skeleton in a polite live
region, and an answer laid out conclusion first, claims with their evidence labels, then
tappable evidence cards that deep-link to the reading or event; thumbs feedback; stored asks
reopen with zero model calls. "Ask about this journey" is live and restricted to journey
evidence. The same vectors feed the `semantic_similarity` signal of correlation and journey
affinity. Purge, export (`export/1.4.0`) and "Delete AI artifacts" cover the three new
tables; the demo journal carries 42 documents and vectors and answers the six benchmark
questions and the two adversarial ones with zero fabrication (`pnpm eval`).

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Stages stream; answer text does not.** The run yields `parsing → searching → ranking → answering → verifying` into a skeleton and the answer only after step 7 | An unverified claim must never be on screen (§19). Streaming the model's JSON would show fabricated citations before they are stripped. The skeleton says what is happening, which is what "streaming with a skeleton" is for | Streaming text deltas and re-rendering after verification |
| **Citations are short labels (`E1…En`) mapped to object ids server-side** | A model citing UUIDs is error-prone; labels are verifiable against the package and mapped back to `{object_type, object_id}` before storage | UUID citations in the schema |
| **Hints re-rank; only the explicit scope, the parsed time range and the content type narrow** | A wrong entity or card hint must cost rank, not recall; a wrong time range is an honest "nothing in January". Scope chips are the user's word and are hard filters | Hard-filtering on every parsed hint |
| **Over the 400 cap, objects with more structural hits come first, then recency** | The doc's "recency when over cap" alone would drop a 1000-reading user's old "independence" readings before ranking sees them; hits first keeps the doc's intent (structured narrowing) with recency as the tiebreaker | Pure recency cut |
| **Bounding is a strict rank prefix** | "Drop the lowest-ranked whole objects" taken literally: the first object that does not fit ends the package, so nothing lower-ranked displaces something higher-ranked. Labels are re-issued E1…En with no gaps | Greedy fill (a small low-ranked object could jump a large high-ranked one) |
| **Augmentation follows each anchor with its linked objects; in a journey scope nothing outside the candidate set is added** | A cited reading should travel with the outcome or event that makes it evidence (§8.1 step 4); a journey ask may only cite journey evidence, and the SQL already admits members ∪ their confirmed/maybe-linked objects | Augmenting after the bound (would break the bound), or from the whole journal in journey scope |
| **An empty candidate set is answered without a model call** | "Nothing in your history matched this scope" is the designed state and needs no model; it also makes the adversarial "empty month" free | Calling the model with an empty package |
| **The evidence package carries a 240-character excerpt of the user's note** (never the retrieval document) | Specificity: "Sam said the same thing…" is what makes an answer believable; the *embedding* provider still receives only the template. Bounded and marked as their words | Notes in the retrieval document (privacy), or no notes at all (generic answers) |
| **Retrieval documents are rebuilt from write paths through a deduped job, 90 s after a save** | The extraction that follows a save usually lands first, so the document is built once with its themes and entities; the materialiser's own enqueue finds the queued job. No cron sweep | Building synchronously on save (two embeddings per save), a nightly sweep |
| **Embedding needs consent; the document does not** | The document is deterministic derived text; the vector is a provider call. A user without consent gets documents and no vectors (and no Ask, which also needs the flag) | Gating the document on consent |
| **`retrieval_documents` die with their object by trigger *and* by the purge job** | An FK cannot reach a polymorphic key; the trigger makes the cascade real for any delete path, the job step keeps the registry's count-remove-verify contract | Job only (a raw delete would strand vectors) |
| **`asks` are scrubbed, not deleted, when a cited object is purged** | The question is the user's and the verified answer names no content of the entry; every reference (citations, claims, package, dropped) is removed and verified zero. "Delete AI artifacts" removes asks entirely — a transcript of the AI feature, not a journal entry | Deleting asks with their evidence; leaving dangling ids |
| **`build_retrieval_document` stays deterministic; its `TaskId` names the embedding request** | The template is compact by construction; a model compression step would add cost and a non-determinism for nothing. The id in `ai_calls` says which document embeddings were for | A fast-tier compression call per document |
| **Cancel ends the run at the next step boundary; a model call in flight finishes and is discarded** | `runObject` owns its own timeout/abort policy; racing the call against the user's abort gives the screen an immediate stop and keeps the runner's contract | Threading a caller signal through the runner (a runner change in a phase that does not own it) |
| **The mock answerer requires two relevant entries; "relevant" is a strong match (entity, axis, card, topic word in the entry's own words or tags) or, failing that, a weak one (life area, journey)** | The adversarial "person who appears once" must read as insufficient; a single topic-word hit alone must not carry an answer; a question with no hints falls back to retrieval's ranking | Score threshold on a single relevance number (the first cut, which let a life-area match count as evidence) |
| **The theme-only labelled pair keeps missing** (0.43 with mock vectors, semantic 0.58) | With `entity_overlap` available-at-zero (Phase 08's rule) the pair cannot reach 0.55 unless similarity is near 1; changing that rule or the thresholds on one pair with hashed-bag-of-words vectors would be tuning to the mock. The pair now carries its retrieval texts so the signal is visible; the decision belongs with the real-model read | Treating entity overlap as unavailable when neither side has entities (would also lift unrelated theme pairs) |

## 3. Files and modules

```
src/domain/retrieval/ ★
  document.ts          buildRetrievalDocument — the §8.3 template, caps, hash, BUILDER_VERSION retrieval_document/1.0.0
  hashEmbedding.ts     hashed bag-of-words at 1536 dims (moved out of the mock so fixtures can use it), cosine, vector literal parse/format
  query.ts             historyQuerySchema (parse output), HISTORY_INTENTS, askScopeSchema, EXAMPLE_QUESTIONS, resolveTimePhrase
  rank.ts              RANK_WEIGHTS, rankCandidates (renormalised), structuralMatch, recencyOf (inverted for first_occurrence)
  bound.ts             PACKAGE_MAX_OBJECTS 24, PACKAGE_MAX_TOKENS 6000, boundPackage (strict prefix), estimateTokens
  evidence.ts          EvidenceObject, renderEvidence (derived fields marked), labelEvidence, CITEABLE_LINK_STATES, NOTE_EXCERPT_CHARS
  answer.ts            historyAnswerSchema, verifyAnswer (strip → uncited → register), insufficientAnswer, citedLabels
  __tests__/           document (snapshots), query, rank, bound, answer + evidence rendering
src/retrieval/ ★
  objects.ts           loadHistoryObjects — one loader for documents and evidence (fixed query count, user-scoped, resolved entities only, citeable links only)
  documents.ts         toDocumentInput, rebuildRetrievalDocument (one current row, hash no-op, deleted → row removed)
  embed.ts             embedDocumentRows / embedDocument / listStaleDocuments — stored text only, consent-gated, EMBED_BATCH 16
  backfill.ts          embedObject (job body), backfillEmbeddings (bounded, re-enqueues)
  enqueue.ts           enqueueEmbedSafely, EMBED_AFTER_SAVE_DELAY_MS 90 s
  vectors.ts           loadEmbeddingsFor — the semantic signal for correlation and journeys
  search.ts            resolveHints (aliases, journeys, card search), searchParams, searchHistory (rpc search_history as the user)
  ask.ts ★             askHistory — the seven-step generator; augment, packageFrom, toEvidenceObject, AskEvent / AskResult
  __tests__/           mocks.test.ts (unit), retrieval.integration.test.ts (9)
src/ai/tasks/parse_history_query/ ★   prompt, schema (re-export), version, index (buildParseHistoryQueryRequest), mock, fixtures/benchmark.json + baseline
src/ai/tasks/answer_from_evidence/ ★  prompt, schema (re-export), version, index (buildAnswerFromEvidenceRequest, repairHint, MockEvidenceObject), mock, fixtures ×8 + baselines
src/ai/index.ts        both tasks registered; embeddingModelId()
src/ai/providers/mock.ts  mockEmbedding = hashEmbedding (domain)
src/ai/tasks/extract_reading_metadata/mock.ts  + independence rule
src/db/schema/retrieval.ts ★, migrations/0010_retrieval_ask.sql ★  (3 tables, HNSW, RLS, cascade triggers, search_history())
src/db/queries/asks.ts   createAsk, getAsk, listAsks, setAskFeedback, deleteAsk (as the user)
src/jobs/handlers/       payloads.ts (+2), embed-object.ts, backfill-embeddings.ts (lazy), index.ts
src/memory/materialize.ts, app/(app)/reading/actions.ts, app/(app)/event/actions.ts  rebuild triggers (embed job)
src/correlation/features.ts, src/journeys/features.ts  vectors attached → semantic_similarity available
src/domain/privacy/deletionRegistry.ts  reading + life_event roots: retrieval_documents (job), embeddings (cascade), asks (job); user root +3
src/privacy/purge.ts     counters/removers; countAskReferences, scrubAskReferences
src/privacy/aiArtifacts.ts  + embeddings, retrieval_documents, asks
src/domain/export/schema.ts (export/1.4.0: asks.json, ask_cites), src/export/build.ts
src/observability/logger.ts  'retrieval' / 'ask' namespaces; askId, stage, packageSize, dropped, tokens
src/ui/lib/sse.ts        readSse (shared with the interpretation panel)
app/api/ask/route.ts ★   POST → SSE (consent + flag), cancel on disconnect
app/(app)/ask/ ★         page.tsx (composer + earlier questions; flag / consent states), ask-composer.tsx ★, answer-view.tsx ★, ask-feedback.tsx, actions.ts, [id]/page.tsx (stored ask, zero calls)
app/(app)/journey/[id]/page.tsx  "Ask about this journey" live behind the flag
app/(app)/profile/privacy-controls.tsx  dialog names vectors and asks
scripts/seed-demo-retrieval.ts ★ (registered), seed-demo-readings.ts (+4 Ana stories: Bali, Thailand, independence), eval.ts (parse + ask sections, latency/cost line)
fixtures/history/correlation/labeled-pairs.json  the theme-only pair carries retrieval texts; __tests__/fixtures.ts embeds them
e2e/ask.spec.ts ★, e2e/_helpers.ts (ask flag, enqueueEmbeddings, seedJourney), e2e/journal.spec.ts (1.4.0)
Tests: src/db/__tests__/retrieval.rls.test.ts ★ (5), deletion-registry (+3 tables), invariants: deleting-reading-purges-derived (+retrieval, asks; integration +vector, +ask scrub)
```

## 4. Database changes

`0010_retrieval_ask.sql` (`drizzle-kit generate --name retrieval_ask`, hand-written after the
marker), applied on the local database:

- Tables: `retrieval_documents` (unique `(object_type, object_id)`; text 1–2000 by check;
  RLS **select + delete own**, no session insert/update), `embeddings` (`vector(1536)`,
  FK `retrieval_document_id` **on delete cascade**, unique per document, **HNSW
  `vector_cosine_ops`**; RLS select + delete own), `asks` (status / feedback / question
  checks; RLS select / update / delete own, **insert only pending and answerless**).
- Triggers: `set_updated_at` on `retrieval_documents`; `retrieval_documents_cascade()`
  (`SECURITY DEFINER`) fired `AFTER DELETE` on `readings` and `life_events`.
- Function: `search_history(p jsonb)` — `SECURITY INVOKER`, `STABLE`; hard filters (scope,
  time range, content type), similarity for the narrowed set, structural counters
  (`entity_hits` over resolved mentions, `journey_hit`, `card_hits`, `life_area_hit`,
  `keyword_hits`, `confirmed_links`), cap 400 ordered by hits then recency; returns nothing
  without `auth.uid()`.
- Deletion registry: see §3. `check-deletion-registry` and the registry unit test named all
  three tables before registration.
- DATA_MODEL.md's retrieval section rewritten to the built shape (the `asks` columns beyond
  the planned five; the two-way cascade; the constrained insert); `period_summaries` stays
  planned for 10 with `object_type = 'period_summary'` already admitted.

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|
| `parse_history_query` | `parse_history_query/1.0.0` | `history_query/1.0.0` | fast | New. Input: the question and today's date. Output: intent (8 stable keys), absolute time range, life area, entity / journey / card hints, comparison axes, object types, keywords. `maxTokens` 400. Mock: rule-based (intent verbs, `resolveTimePhrase`, capitalised names, card names, a stop list). |
| `answer_from_evidence` | `answer_from_evidence/1.0.0` | `history_answer/1.0.0` | deep | New. Input: question, scope, parsed hints, the rendered package, dropped count. Output: `evidence_sufficient`, conclusion (≤ 700), ≤ 8 claims with `E\d+` citations, `found`, `narrower_question`. `maxTokens` 1400. One repair turn (`repairHint`) on verification failure. Mock: reasons over the package by intent; cites only given labels; two relevant entries minimum. |
| `build_retrieval_document` | — | `retrieval_document/1.0.0` (builder) | — | Deterministic; the id names the embedding request. |

Eval (`pnpm eval --dry`, mock — no keys anywhere): `parse` 8/8; `ask` 8/8 — six benchmark
questions sufficient with 3–7 verified citations each, two adversarial ones insufficient with
what was found; **zero invented cards, zero invented dates, zero unverified citations**;
latency p95 85 ms (mock). Baselines in both tasks' `fixtures/__baselines__/` with empty
`human_review`. **The real-model runs and the human reads are owner tasks** (as 04/06/07/08).

Mock lessons worth keeping for the real prompt: the first relevance rule let a life-area
match alone make an unrelated entry "relevant" (a work event under "relationship readings"),
and a keyword like "this" matched "this week" — so the parser now stop-lists demonstratives
and seasons and resolves "this summer" to a range, and the answerer needs a strong match
before a weak one counts. The real model will not have the first problem but the prompt
already says "use only the evidence given" for the same reason.

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `RANK_WEIGHTS` | `domain/retrieval/rank.ts` | 0.60 / 0.20 / 0.15 / 0.05 | as written; a perfect candidate scores exactly 1 (unit) |
| `RECENCY_TAU_DAYS` | same | 365 | exp(−1) at a year; inverted for `first_occurrence` (unit) |
| `LINK_DENSITY_SATURATION` | same | 3 | three confirmed connections saturate the 0.05 term |
| `NARROW_LIMIT` | `retrieval/search.ts` + SQL | 400 | as written; hits first, then recency (integration at 1000) |
| `PACKAGE_MAX_OBJECTS` / `PACKAGE_MAX_TOKENS` | `domain/retrieval/bound.ts` | 24 / 6000 | as written; strict prefix (unit); 24 objects ≈ 2 500–2 900 estimated tokens on the demo |
| `CHARS_PER_TOKEN` | same | 4 | conservative estimate; real counts are lower |
| `DOCUMENT_MAX_CHARS` and list caps | `domain/retrieval/document.ts` | 700; themes 6, cards 10, entities 6, possibilities 2, linked 2 | demo documents are 60–330 chars; the cap drops whole trailing segments (unit) |
| `NOTE_EXCERPT_CHARS` | `domain/retrieval/evidence.ts` | 240 | enough to quote, small enough to keep 24 objects under 6000 tokens |
| `EMBED_BATCH` | `retrieval/embed.ts` | 16 | one call per 16 documents in a backfill |
| `EMBED_AFTER_SAVE_DELAY_MS` | `retrieval/enqueue.ts` | 90 s | after the 60 s notes-extraction delay, so the document is built once with its extraction |
| `MIN_RELEVANT` (mock answerer) | `tasks/answer_from_evidence/mock.ts` | 2 | one mention is "not enough evidence" (the adversarial case) |
| `ASK_QUESTION_MAX` | `domain/retrieval/query.ts` | 300 | a question, not an essay |

ALGORITHMS.md §4 rewritten to match (steps as built, the cap ordering, the prefix bound, the
document template, the semantic signal in §2/§3).

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/retrieval/__tests__/document.test.ts` (6) | inline snapshots for a Thoth reading (every segment, "Lust" never "Strength"), a life event, an open reflection; determinism and hash change; list and length caps drop whole segments and never the words; no notes field exists |
| unit | `query.test.ts` (4), `rank.test.ts` (6), `bound.test.ts` (5), `answer.test.ts` (8) | relative phrases incl. seasons and future months; schema bounds and closed scopes; the six examples verbatim; weights and renormalisation, structural lift, null-vector degradation, recency inversion, stable ties; 24 / 6000, strict prefix, single object over cap dropped; stripping, uncited → ungrounded, sufficient-without-claims → ungrounded, register, label form, the fallback; the evidence rendering snapshot |
| unit | `retrieval/__tests__/mocks.test.ts` (7) | the six §6.6 questions parse to the intended intents / ranges / axes; the answerer cites only package labels and passes verification, says insufficient for a once-mentioned person, an empty package and a one-sided comparison, and never uses certainty language |
| unit (invariant) | `deleting-reading-purges-derived` (+2 job targets per root, scrub SQL, cascade triggers in the migration), `deletion-registry` (+3) | see the ledger |
| integration | `retrieval/__tests__/retrieval.integration.test.ts` (9) | the document from stored rows (Thoth names, entities, no note marker); **the spy embedder receives exactly the stored text**; unchanged hash → nothing sent; outcome and correction rebuild and re-embed; one row per object; no consent → document without vector; the event path; **purge job and trigger both remove the vector**; backfill twice → no-op, model change → all stale; **package excludes a soft-deleted reading, the event behind a rejected link and a tentative entity** (and search counts no tentative hit); a fabricated label is stripped; **two uncited answers → degraded to insufficient, stored as such**; another user's journey / entity scope → nothing, their reading never in an unscoped package; a journey scope cites members only; cancel → `failed / cancelled`; **1000 objects: 400 candidates, package 24, hits-first ordering, timings printed**; a session cannot insert a completed ask |
| integration | `deleting-reading-purges-derived.integration` (+vector purged, +ask scrubbed to the survivor's citation, +receipt counts asks) | |
| rls | `db/__tests__/retrieval.rls.test.ts` (5) | documents and vectors: owner reads and deletes own, B and anon read none, no session insert or update; asks: standard isolation with a constrained insert (`42501` on a forged complete row); **`search_history` as B with A's user id and journey id in the parameters returns nothing, as A returns A's row at similarity 1, anon nothing**; the owner's delete path |
| e2e | `e2e/ask.spec.ts` (1 × 2) | **390 px + desktop:** four readings extracted and embedded by the cron → /ask shows the §6.6 examples and scope chips, axe clean → keyboard to *Ask* → the live region and skeleton → "From your history", the conclusion names Eight of Cups, "appeared 2 times", evidence cards are links named `E1: reading on …`, none of them the health reading, no Thoth name where none was cited → axe → thumbs → tap a citation → the right reading → reopen the stored ask from *Earlier questions* → same answer, thumbs kept, **`ai_calls` unchanged** → axe → "What did my readings say about Priya?" → *Not enough evidence*, "none mention Priya", a narrower question, no evidence links → the journey's *Ask about this journey* → scope locked, every evidence id is a member |

Invariant tests unskipped this phase: none new; `deleting-reading-purges-derived` extended
(structural: `retrieval_documents` and `asks` job targets on both roots, the scrub SQL and
both cascade triggers asserted; database: vector gone, ask scrubbed).

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  59 passed | 1 skipped (60)
      Tests  417 passed | 1 skipped (418)          (unit)
 Test Files  19 passed (19)
      Tests  122 passed (122)                      (integration)

$ pnpm test:rls
 Test Files  12 passed (12)
      Tests  51 passed (51)

$ pnpm build && pnpm check:client-bundle && BASE_REF=HEAD pnpm check:prompt-versions
 ✓ Compiled successfully in 7.7s
├ ƒ /api/ask 169 B (103 kB) · /ask 7.84 kB (147 kB) · /ask/[id] 1.26 kB (116 kB)
check-client-bundle: ok (75 files scanned)
check-prompt-versions: ok

$ pnpm test:e2e            (mobile 390×844 + desktop, fresh `next start`)
  124 passed (3.4m)        — ask.spec: 2 passed (8.6 s / 8.8 s)

$ pnpm db:migrate  →  migrations applied (0010_retrieval_ask)
$ pnpm demo:seed   →  42 retrieval documents built, 42 vectors embedded (demo-ana)
$ pnpm eval --dry  →  parse ✓ 8/8 · ask ✓ ×8 (six sufficient, two insufficient; 0 invented cards / dates)
                      ask · latency p95 85 ms over 8 asks · 15 model calls · 1500 in / 750 out tokens · $0.0000 per ask
                      correlate ✓ precision 100% · recall 88% (missed: health-theme-only-close)
                      eval: all mechanical checks passed — now read the baselines.
```

Registry gate fired for the three tables before they were registered:
```
Deletion registry is missing user-owned table(s): asks, embeddings, retrieval_documents
```

| Metric | Target | Measured |
|---|---|---|
| Steps of §8.1 implemented | 7 | 7 (parse, narrow, rank, augment, bound, answer, verify) |
| Package bound | ≤ 24 objects, ≤ 6000 tokens | 24 / 2 472–2 957 estimated tokens on the demo; 24 at 1000 readings; strict prefix (unit) |
| Candidates at 1000-reading scale | ≤ 400 | 400, hits first |
| `search_history` at 1000 objects | fast | **124 ms** (integration, local Postgres) |
| Backfill at 1000 objects | bounded | 8.7 s for 1000 documents + vectors (mock embedder; 63 batches) |
| End-to-end ask latency, mock | recorded | p95 **85 ms** over the 8 benchmark asks (eval); 49–239 ms per ask. **Real-model p95 is an owner measurement** (`pnpm eval` prints it) |
| Token cost per ask, mock | recorded | 1 500 in / 750 out over 8 asks = ~190 in / 94 out per ask at the mock's fixed counts; $0.0000. Real cost is the parse (fast) + one deep call over ≤ 6000 evidence tokens + ≤ 1400 out, printed by `pnpm eval` |
| Outbound embedding payload | = stored `retrieval_documents.text` | byte-identical (spy embedder, integration) |
| Fabrication in evals | 0 | 0 invented cards, 0 invented dates, 0 unverified citations |
| Answers with unverified citations shipped | 0 | verifier strips; two failures degrade (integration) |
| Model calls per stored ask opened | 0 | e2e: `ai_calls` unchanged; the page reads the row and the cited objects |
| Labelled correlation precision / recall | ≥ 0.8 precision | 1.00 / 0.86 (unchanged; the theme-only pair reaches 0.43 with mock vectors) |
| Unit / integration / RLS / e2e | fast | 9 s / 54 s / 13 s / 3.4 min |

Manual checks actually performed:
- [x] **Ten questions of the demo history, read by hand** (the six benchmark, the two adversarial, "What did I ask about health this summer?", "How do I feel about Sam?"). Specific and believable: Q2 (three cards that genuinely recur across the agency readings, each dated), Q4 (four readings with the user's own outcomes and confirmed connections, quoted), Q5 (the April Bali reading as the first Independence tag, the three later ones). Honest: Priya and January. Adequate: Q1, Q3, Q6, the health summer. **Weakest answer, verbatim** ("How do I feel about Sam?"): *"Your history holds 5 entries that seem to bear on this, from 2026-04-17 to 2026-09-13."* followed by five dated entries that mention Sam. It is grounded and cites correctly, but it is a list, not a reading of feeling — the mock has no `other`-intent reasoning beyond listing, and the real model's answer here is exactly the §22 question ("does the evidence display make the conclusion credible?"): the evidence cards do, the sentence does not. Second weakest, before the fix: the health-summer answer included "What do I carry into this week?" through the keyword "this" — fixed in the parser (stop list, seasons).
- [x] **390 px screenshots, light + dark:** the composer with examples and chips; the Q4 answer (conclusion, four cited claims with E-labels, four evidence cards with deck names and "why this matters"); the Priya insufficient state ("Found 24 entries in this scope, but none mention Priya", the narrower question as a button, the honesty line); *Earlier questions*.
- [x] **Keyboard:** the e2e tabs to *Ask* and presses Enter; scope chips are `role=radio` buttons in a labelled group; evidence cards are native links; claim labels are in-page anchors; thumbs are buttons with `aria-pressed`.
- [x] **Screen reader:** stages and failures land in a polite `role=status` live region; every evidence link has a descriptive accessible name (`E3: reading on 2026-04-05, Should I apply…`); the answer is an `article` labelled by its conclusion; the insufficient state is a heading, not an error.
- [ ] **Real-model `pnpm eval`** and the human read of the nine baselines — owner (no key).

## 9. UX notes

"Not enough evidence" is a state with its own eyebrow, what was found, and a narrower question
that is one tap (it re-asks). The answer card says where it comes from ("from the ones listed
below and nothing else") and how many entries were left out. Derived fields reach the model
labelled "(derived)" and the prompt tells it to say "the journal noted", not "you said".
Journey asks lock the scope and retitle the page. Ben (no AI) sees the plain consent sentence
with a link to Profile; a flag-off account sees the rollout sentence.

Rough edges left deliberately: the answer's E-labels are small in-page anchors, not popovers;
the evidence card repeats the claim it supports ("why this matters"), which reads doubled when
one claim cites four entries; the stored-ask page has no delete control (the action exists);
"Ask about this journey" on the journey page is a link, so the composer's other scope chips
are disabled rather than hidden.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Real-model `pnpm eval` for `parse_history_query` and `answer_from_evidence`, human read of the nine baselines, then `FLAG_ASK_MY_HISTORY=true` (env default stays off; the demo and e2e users are on the rollout flag) | No provider key (as 04/06/07/08) | owner |
| Real-model p95 latency and $ per ask | Same; `pnpm eval` prints both | owner |
| **Run the §22 validation study** (10–20 users) — the §17 MVP experience is now complete | A study, not code | owner, before Phase 10 |
| `build_retrieval_document` as a model compression step | The deterministic template is 60–330 chars on the demo; nothing to compress | if documents ever exceed the cap in practice |
| Entity-context vectors for `embeddingSimilarity` in entity resolution | Vectors are per object, not per entity | when resolution needs it |
| The theme-only labelled pair (`health-theme-only-close`) passing | 0.43 with mock vectors; needs either real embeddings or a change to Phase 08's "entity overlap available at zero" rule — decide on the real-model read | owner / 12 |
| Covering period summaries in augmentation | Phase 10 (`object_type = 'period_summary'` is admitted everywhere; `packageFrom()` is the hook) | 10 |
| Journey rename → member documents rebuilt | Not in the phase's trigger list; the next rebuild of each member picks the title up | when asked |
| A "re-embed everything" ops entry for a model change | `backfill_embeddings {userId: null}` is the job; a cron entry / `pnpm jobs:backfill` script is a 12 ops item with the purge sweep | 12 |
| Delete control on the stored-ask page; `AskComposer` / `AnswerView` in `/dev/ui` | Action exists; islands bound to the route | 12 |
| Threading the request abort into the runner (a call in flight is discarded, not aborted) | Runner contract change | 12 |

## 11. Known issues and risks

- **The mock parser and answerer are English rule scaffolding.** They answer the benchmark
  because the demo notes carry the words they catch; the real prompts have not been run.
  Fabrication checks in the eval (invented cards / dates, unverified citations, false
  "sufficient") are what to watch on the first real run — the verifier will strip and degrade,
  and the eval line will say so.
- **The demo's extractor decides what is "relevant" to the mock answerer.** A work event
  tagged `relationships` by the mock extractor ("say yes" → communication) sits in the
  relationship package; the real extractor will not do that, but the answer prompt already
  tells the model to use only the evidence.
- **`search_history` computes similarity for the narrowed set, not through the HNSW index**
  (per-user rows are filtered first). At per-user scale this is 124 ms for 1000 objects; the
  index is there for a future global-then-filter plan if a user ever holds tens of thousands.
- **Two asks in parallel from one user are two runs**; there is no per-user lock or rate
  limit beyond the AI budget hook (Phase 11).
- **A model change re-embeds everything through the backfill**, which is bounded per run and
  re-enqueues itself; nothing schedules it today (see §10).
- `pnpm eval --dry` rewrites the other tasks' baselines' `ran_at` (and, for
  `extract_reading_metadata`, would overwrite the owner's real-model baselines with mock
  output); reverted so the diff carries only the nine new baselines.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste keys into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm eval --dry
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` → *Ask* in the bottom nav → the six
   example questions; tap *Did any of my old career readings line up with what later
   happened?* → *Ask* → the stages, then "From your history": four readings with the outcomes
   Ana recorded and the connections she confirmed, each an evidence card → tap one → the
   reading.
2. Ask *What did my readings say about Priya?* → "Not enough evidence", what was found, a
   narrower question → tap it → it re-asks.
3. Ask *Compare my readings about Bali and Thailand.* → two claims, one per place, the cited
   readings below; *When did I first start getting themes of independence?* → the April Bali
   reading first.
4. Journey → *The agency and decision* → *Ask about this journey* → the scope is locked → ask
   the career question → every evidence card is a member of the journey.
5. Profile → *Delete AI artifacts*: the dialog counts search vectors and questions; confirm →
   /ask has no earlier questions; `pnpm jobs:run` after `backfill_embeddings` is enqueued
   (or `pnpm demo:seed`) restores the vectors.
6. Delete a cited reading from the journal → open the stored ask → its card is gone and the
   others remain.

## 13. Notes for the next phase

- **Summaries (10):** `retrieval_documents.object_type = 'period_summary'` is admitted by the
  schema, the builder (`text` = headline) and the search function; `packageFrom()` is where a
  covering summary joins the package — as compression, never as the sole evidence
  (`summary-never-sole-evidence`). `renderEvidence` needs a `period_summary` branch.
- **Journey narrative (10):** `askHistory({scope: {kind: 'journey'}})` already restricts the
  candidate set; a narrative header is a summary, not an ask.
- **Ask history as a §16 signal:** `asks.feedback`, `evidence_sufficient` and
  `citations.length` are the counts to chart; never the question text.
- **Budgets (11):** the ask is one fast + one deep call (+ one embedding); `ai_calls` rows
  carry `ask` object refs and `dropped_<type>` refs for the package provenance.
- **Ops (12):** `backfill_embeddings {userId: null, limit}` after an embedding-model change;
  the cascade triggers mean a raw delete never strands a vector.
