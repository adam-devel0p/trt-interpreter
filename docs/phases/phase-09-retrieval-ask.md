# Phase 09 — Hybrid Retrieval & Ask My History

**Deps:** 08 · **Spec:** §8, §6.6, FR-18, FR-19, §13, §19 · **Outcome:** the user can ask their own
history questions in plain language and get answers that are grounded, bounded, cited, and honest when
the evidence is thin.

> **This is the validation checkpoint.** Every *experience* in the §17 MVP list now exists (§17's
> remaining item, minimal subscription/metering plumbing, lands in Phase 11 and is not needed to test
> the hypothesis). Run the §22 study with 10–20 users here, before building 10–12.

## Scope

**In:** retrieval documents, embedding pipeline, hybrid retrieval, `parse_history_query`,
`answer_from_evidence`, citation verification, Ask screen, journey-scoped Q&A, `asks` table,
re-embedding on change, deletion of derived vectors.

**Out:** period summaries (10 — retrieval augments with them once they exist; build the hook now).

## Tasks

### 1. Schema
`retrieval_documents`, `embeddings`, `asks` per [../DATA_MODEL.md](../DATA_MODEL.md#retrieval--summaries--phases-09-10).
HNSW index on `embeddings.vector`. Cascade from parent objects so deletion kills vectors (§19).
RLS on all three; vector similarity queries are always additionally filtered by `user_id` (never rely on
the index alone).

### 2. Retrieval documents (§8.3)
- Deterministic template builder in `src/domain/retrieval/document.ts` — pure, snapshot-tested:
  `"{journey}. {question|description}. Themes: … Cards: {deck-native names} … Entities: {canonical
  labels}. Possibility: … Timeframe: … Outcome: …"`
- Built for readings, life events and (Phase 10) summaries. One current row per object;
  `content_hash` prevents redundant re-embedding.
- Rebuilt when the object, its newest extraction, its overrides, or its confirmed links change —
  triggered from those write paths via a job, not a cron sweep.
- **Compact by design:** cap length; the point is precision and cost control, not completeness (§13).

### 3. Embedding pipeline
- `embed_object` job, batched, idempotent, retried; `model` + `model_version` stored so a model change is
  a re-embedding job rather than a rewrite.
- Only the retrieval document is sent to the embedding provider — never raw notes
  ([../PRIVACY_AND_DELETION.md](../PRIVACY_AND_DELETION.md)). A test asserts the outbound payload equals
  the stored `retrieval_documents.text`.
- Backfill job for existing objects; runs against demo seed.

### 4. Hybrid retrieval (§8.1)
Implement all seven steps from [../ALGORITHMS.md](../ALGORITHMS.md#4-hybrid-retrieval-81):
1. `parse_history_query` → intent, time range, life area, entity hints, journey hints, card hints,
   comparison axes. Entity hints resolve through `entity_aliases`; card hints through `card_aliases` so
   cross-deck terms work (FR-03C).
2. Structured narrowing in SQL (cap 400 candidates).
3. Semantic re-ranking: `0.60·semantic + 0.20·structural + 0.15·recency + 0.05·confirmed_link_density`.
4. Augment with linked events, outcomes, user-confirmed links, covering summaries (hook for Phase 10).
5. Bound the package: ≤24 objects, ≤6000 evidence tokens, whole objects only, dropped IDs recorded.
6. `answer_from_evidence` with a citation-required schema and `evidence_sufficient: boolean`.
7. **Verify:** every citation must exist in the package; unknown IDs stripped and one regeneration
   attempted; if claims remain uncited → degrade to "not enough evidence" rather than shipping an
   uncited claim (§19).

Retrieval must never include: tentative entities as fact, rejected links, soft-deleted objects, or
another user's anything (assert each with a test).

### 5. Ask screen (§6.6)
- Composer with example questions drawn from §6.6, and scope chips (all history · a journey · a person ·
  a date range).
- Answer layout: **conclusion first**, then an evidence list of tappable source cards (date, question,
  cards, one-line why-this-matters) that deep-link to the reading/event (FR-19).
- "Not enough evidence" is a designed state, not an error: shows what *was* found and suggests a
  narrower question.
- Ask history persisted in `asks` (question, answer, citations, sufficiency, model/prompt version) with
  thumbs feedback (§16).
- Streaming with a skeleton; cancellable; never blocks the rest of the app.
- Gated by `flags.ask_my_history`.

### 6. Journey-scoped Q&A (§6.5 last row)
Enable "Ask about this Journey" — identical pipeline with the candidate set restricted to journey
members and their linked objects. Answers may only cite journey evidence.

### 7. The six benchmark questions (§6.6)
Build an eval set that must answer these well, on demo data:
1. How have my relationship readings changed since June?
2. What cards keep appearing when I ask about leaving my job?
3. Compare my readings about Bali and Thailand.
4. Did any of my old career readings line up with what later happened?
5. When did I first start getting themes of independence?
6. What questions do I keep asking without resolving?
Each has an expected-evidence set; the eval asserts the answer cites it and does not fabricate.
Add two **adversarial** questions whose honest answer is "not enough evidence" (e.g. about a person who
appears once, or a period with no readings).

## Test plan

- [ ] Unit: retrieval-document snapshots per object type; query-parse fixtures; re-ranking order on
      crafted candidate sets; bounding logic drops whole lowest-ranked objects and never truncates.
- [ ] Integration: embeddings created on save and **deleted with the parent**; re-embedding on
      extraction change; `content_hash` prevents duplicate work; backfill is idempotent.
- [ ] Citation verification: a fabricated citation ID is stripped; an answer that cannot be grounded
      degrades to insufficient-evidence (force this with a stubbed provider response).
- [ ] Exclusion tests: soft-deleted objects, rejected links and tentative entities never appear in a
      package; a cross-user ID injected into a scope parameter returns nothing.
- [ ] **RLS + isolation:** vector search as user B never returns A's rows even with a crafted query.
- [ ] **Invariant `deleting-reading-purges-derived.test.ts`** extended to `retrieval_documents` and
      `embeddings`.
- [ ] Cost/perf: package token count stays under cap at 1000-reading scale; p95 end-to-end answer
      latency recorded; token cost per ask recorded in the report.
- [ ] E2E at 390px: ask two of the benchmark questions on demo data → tap a citation → land on the
      right reading; ask an adversarial question → see the honest insufficient-evidence state; ask
      inside a journey → answer cites only journey evidence.
- [ ] a11y: streaming answer in a polite live region; citations are real links, keyboard-reachable, with
      descriptive accessible names.
- [ ] `pnpm eval`: all six benchmark questions + two adversarial ones. **Fabrication is a phase blocker**
      — if any answer invents a pattern or cites something absent, fix before completing.

Manual:
- [ ] Ask 10 questions of the demo history yourself. Judge: is the answer specific, is the evidence
      convincing, would you believe it? (§22 "Which evidence display makes AI conclusions feel credible?")
      Record the weakest answer verbatim in the report.

## Exit criteria

- [ ] Hybrid retrieval implemented end to end with all seven steps and hard bounds.
- [ ] Every answer carries verified citations or honestly says evidence is insufficient.
- [ ] Journey-scoped Q&A restricted to journey evidence.
- [ ] Only compact retrieval documents leave the system to the embedding provider (tested).
- [ ] Vectors die with their parent objects.
- [ ] Six benchmark + two adversarial evals pass with zero fabrication.
- [ ] Report (latency, cost per ask, weakest answer) + `../PROGRESS.md` + `../ALGORITHMS.md` updated.
- [ ] **Checkpoint:** the §17 MVP experience is complete and the hypothesis of §17 is testable
      end to end. Recommend running the §22 validation study before starting Phase 10.
