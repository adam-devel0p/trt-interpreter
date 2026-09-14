# AI Layer

Provider-agnostic boundary (§9.4). Nothing outside `src/ai/` may talk to a model provider, and
`src/ai/` only ever executes server-side.

## Provider interface

```ts
// src/ai/provider.ts
export interface AiProvider {
  readonly id: string;                       // 'anthropic' | 'openai-embeddings' | 'mock'
  generateObject<T>(req: ObjectRequest<T>, call: ResolvedCall): Promise<ObjectResult<T>>;
  generateStream(req: StreamRequest, call: ResolvedCall): AsyncIterable<StreamChunk>;
  embed(req: EmbedRequest): Promise<EmbedResult>;   // throws AiProviderError('unsupported') if N/A
}

// run.ts resolves the model and owns policy; a provider makes ONE attempt per call and throws
// AiProviderError with a content-free errorClass ('timeout' | 'rate_limited' | 'server_error' |
// 'invalid_output' | 'refusal' | 'unsupported' | 'unknown').
export interface ResolvedCall { modelId: string; tier: ModelTier; signal: AbortSignal; }

export interface ObjectRequest<T> {
  task: TaskId;
  system: string;
  messages: Message[];
  schema: z.ZodType<T>;
  modelHint?: ModelTier;                     // 'fast' | 'standard' | 'deep'
  maxTokens: number;
  timeoutMs: number;
  userId?: string;                           // for budget enforcement + telemetry
  objectRefs?: ObjectRef[];                  // logged, never content
}

export interface ObjectResult<T> {
  value: T;
  meta: { modelId: string; promptVersion: string; schemaVersion: string;
          tokensIn: number; tokensOut: number; costMicros: number; latencyMs: number;
          repaired: boolean; };
}
```

Callers never pass a model ID. They pass a `task`; `registry.ts` resolves task → model tier → concrete
model ID, so model migration is a one-file change (§9.4).

Callers go through `src/ai/run.ts` (`createAiRunner(...).runObject(req)`), never the provider
directly. It returns a `RunResult<T>` — `{ ok: true, value, meta, attempts }` or
`{ ok: false, status, errorClass, attempts }` with `status` ∈ `invalid_output | timeout |
provider_error | budget_denied | refusal` — and **never throws for a model problem**. The server
entry point is `getAiRunner()` in `src/ai/index.ts`.

**Streamed structured output** (Phase 04): `runStreamObject(req)` takes a `StreamObjectRequest<T>`
(`StreamRequest` + `schema` + optional `validate(value) → issue labels` + `repairHint(issues)`)
and yields `{type:'text'}` deltas, `{type:'reset', reason}` when an attempt is discarded,
then `{type:'done', value, meta, attempts}` or `{type:'failed', status, errorClass, attempts,
issues?}`. It runs the **same policy** as `runObject`: at `done` the accumulated text is parsed,
schema-checked and `validate`d; a failure there is invalid output (one repair turn that echoes
the failed text, the hint and the schema); timeouts retry → downgrade → fail; 429/5xx back off
under the breaker; refusal is terminal. One `ai_calls` row per run. The Anthropic provider
passes `schema` as `output_config.format = json_schema` (constraints such as `minLength` are
stripped for the endpoint — `providers/outputSchema.ts` — and re-checked by Zod after).

**Providers** (`src/ai/providers/`): `anthropic.ts` (SDK client with `maxRetries: 0`, the
runner's abort signal passed through, `output_config.effort = 'medium'` for the `deep` and
`standard` tiers, never for `fast`; `stop_reason: refusal` → `refusal`, `max_tokens` →
`invalid_output`; SDK errors mapped to classes, never re-thrown with text), `openai-embeddings.ts`
(plain `fetch` to `/v1/embeddings`; receives only what the callers hand it — a question for the repeat check or an ask, a stored retrieval document — never notes), `mock.ts` (fixtures may be functions of
the request's `mockInput` hints; object fixtures stream as chunked JSON; `failWith('invalid_json')`
on a stream yields unparseable text; embeddings are a hashed bag-of-words at 1536 dims; the
reported `modelId` is `mock/<routed id>` so a stored row never claims a real model ran).
Pricing per model lives in `src/ai/pricing.ts` (micro-dollars per token; unknown models cost 0
and are flagged on `/dev/ai-usage`).

## Task catalogue

Each task is a directory `src/ai/tasks/<task>/` containing `prompt.ts`, `schema.ts`,
`version.ts` (`PROMPT_VERSION`, `SCHEMA_VERSION`), `index.ts`, and `fixtures/` for evals.

| Task | Phase | Tier | Output | Notes |
|---|---|---|---|---|
| `interpret_reading` | 04 ✅ | deep | layered interpretation | Deck-aware; streams; grounded in `cards` reference rows, not model memory. `interpret_reading/1.0.1` · `interpretation/1.0.0` |
| `classify_safety` | 04 ✅ | fast | category + severity | Runs on the question before interpretation (§10). `classify_safety/1.0.0` · `safety_classification/1.0.0` |
| `detect_repeat_question` | 04 ✅ | fast (embedding + rule) | similarity verdict | Mostly deterministic; no generation needed (FR-25). Embedding request only; the rule is `domain/interpretation/repeat.ts` |
| `extract_reading_metadata` | 06 ✅ | standard | extraction payload | Themes, entities (mentions + relations), possibilities, timeframe (§7.2). Runs as the `extract_reading_metadata` job after save, never in the request path. `extract_reading_metadata/1.0.0` · `extraction/1.0.0` |
| `extract_event_metadata` | 08 ✅ | standard | event extraction payload | Same family as above (`extractionPayloadSchema` + `event_type`, `importance`); materialised by the same code keyed `life_event`. Runs as the `extract_event_metadata` job after save, never in the request path. `extract_event_metadata/1.0.0` · `event_extraction/1.0.0` |
| `propose_entity_candidates` | 06 (folded) | fast | — | Folded into `extract_reading_metadata`'s `entities[]` (one call per save instead of two); resolution is decided in `domain/entities/resolve.ts`. The `TaskId` stays reserved. |
| `propose_journey` | 07 ✅ | standard | title + rationale + confidence band | Naming only; assignment decided in `domain/journeys`. Runs as the `propose_journey` job after discovery (consent + `journey_autocreate`), never in the request path; a user rename pins the title (`title_source = 'user'`); `low` confidence keeps the placeholder. Context is the minimum (§11): dates, questions, resolved entities from `entityContextForObjects`, theme labels — no notes. `propose_journey/1.0.0` · `journey_proposal/1.0.0` |
| `explain_correlation` | 08 ✅ | fast | one hedged sentence | Puts the engine's `reasons` into words for an *offered* link; writes the `explanation` column and nothing else (structurally asserted). Register-checked: no numbers, no "predicted / foresaw / confirmed / will", no card talk; a failing sentence is dropped and the deterministic reasons stay. Runs as the `explain_correlation` job the correlation run queues (consent + `correlation_suggestions`). `explain_correlation/1.0.0` · `correlation_explanation/1.0.0` |
| `parse_history_query` | 09 ✅ | fast | intent, time range, life area, entity / journey / card hints, comparison axes, object types, keywords | Step 1 of §8.1. Hints re-rank; only the time range and content type narrow. The question is the only user text sent. A failure falls back to an empty parse + the deterministic time-phrase resolver. `parse_history_query/1.0.0` · `history_query/1.0.0` |
| `answer_from_evidence` | 09 ✅ | deep | conclusion + claims with E-label citations + `evidence_sufficient` + `found` + `narrower_question` | Steps 6–7 of §8.1. Receives the bounded package only (≤ 24 objects, ≤ 6000 tokens); every label is verified against it, unknown labels stripped, one repair turn, then degrade to "not enough evidence". Register-checked. `answer_from_evidence/1.0.0` · `history_answer/1.0.0` |
| `summarize_period` | 10 ✅ | standard | headline + four sections of claims, each with `basis` (§9.2) and E-label citations | FR-20. Input: the same rendered evidence package the Ask answerer gets (`summaries/evidence.ts`, ≤ 24 objects / 6000 tokens, date order), counts, journeys, the period. Verified by `domain/summaries/provenance.ts`: unknown labels stripped, uncited claims dropped, a `confirmed_fact` that cites no confirmed evidence (event / outcome / confirmed link) dropped, register-checked, one repair turn, else nothing stored. Runs as the `summarize_period` job (consent + `period_summaries` flag + data floor), from the sweep, the seed, or the user's explicit "regenerate" — never on a view. `summarize_period/1.0.0` · `period_summary/1.0.0` |
| `journey_narrative` | 10 ✅ | standard | one sentence + progression labels + citations | §6.5 header. Same package for the journey's live members plus the deterministic progression labels. Verified (citations, register); regenerated only on a material change (`narrativeFingerprint`: member set, confirmed outcomes) or after 14 days; an unverifiable sentence keeps the deterministic header. `journey_narrative/1.0.0` · `journey_narrative/1.0.0` |
| `build_retrieval_document` | 09 (deterministic) | — | compact §8.3 text | The template (`domain/retrieval/document.ts`) is deterministic and no model is called to compress; the `TaskId` names the **embedding** request for a document in `ai_calls` / the mock's call log. A model compression step would slot in here if documents ever needed it. |

**Model routing** (`registry.ts`, overridable per-environment via `AI_MODEL_FAST/STANDARD/DEEP`):
`fast` → `claude-haiku-4-5` · `standard` → `claude-sonnet-5` · `deep` → `claude-opus-5`.
Embeddings → `text-embedding-3-small` (`embeddingModelId()` in `src/ai/index.ts` names the model
a fresh vector would carry; `embeddings.model` is compared against it, so a model change is a
re-embedding job). Routing is data, asserted by a test that every `TaskId` has a tier and every
tier has a model.

## Prompt construction rules (§9.3)

1. **Ground in the reference layer.** Interpretation prompts receive the actual `cards` rows for the
   drawn cards (deck-native name, suit, court term, element/astrology/qabalah, upright + reversal
   meanings, symbolism). The model synthesises from supplied reference data; it is told not to rely on
   its own recollection of card meanings.
2. **Deck system is explicit and enforced.** The system prompt names the deck system and forbids
   cross-system substitution ("this is Thoth; do not use Rider-Waite-Smith names or meanings"). A
   post-generation check greps the output for the *other* deck's card names for the same archetypes;
   a hit fails validation and retries once, then drops to reference-only display. This makes §19's
   Thoth criterion mechanically testable. *Implemented in `domain/decks/purity.ts`:* the banned
   list is the other deck's identifying vocabulary (card names, suit and court labels, deck names)
   minus anything this deck also uses; the other deck's small-card **titles** ("Change", "Success")
   are ordinary words and are never banned, and single-word trump names ("Justice", "Art") match
   case-sensitively so prose ("a sense of justice") passes while a card reference fails. The
   validator also requires exactly one `per_card` entry per drawn position and a hedged register
   (`domain/interpretation/register.ts`); the failed class is stored as `deck_purity` when the
   last attempt's issues include a purity hit.
3. **Position matters.** Each card is interpreted in its named spread position with the position's
   prompt text, never as a standalone card meaning.
4. **The user's words lead.** The exact question and the user's "what I notice" note are quoted into
   the prompt; the model is instructed not to contradict or replace the user's interpretation (§9.3).
5. **Hedged register.** "suggests", "may point to", "one way to read this". Banned: percentages,
   "will", "definitely", "the cards say you must", any supernatural certainty or accuracy claim.
6. **Layered output by construction.** The schema *is* the layering: `synthesis` (one line),
   `per_card[]`, `combined`, `reflective_prompts[]`. The UI shows the first layer by default.
7. **Depth follows the user.** `profiles.ai_explanation_depth` and `experience_level` tune length;
   `experienced` users get shorter AI output and their own notes shown first (§9.3).
8. **Bounded context.** Historical tasks receive only the bounded evidence package, never full history
   (§11, §13).

## interpret_reading — the run (Phase 04)

`src/interpretation/service.ts` orchestrates; `src/ai/tasks/interpret_reading/` owns the prompt,
schema re-export, validator and mock fixture. Order of operations is the contract:

1. the reading exists (loaded through the query layer by the route);
2. `hasAiConsent(profile)` — no consent, no call of any kind (`failed / consent`, no row);
3. an `interpretations` row is written `pending` **before** any model call, carrying
   `metadata_version`, `depth`, `prompt_version`, `schema_version`;
4. `classify_safety` on the question (open reflections skip it); a classifier failure means
   "none"; a hit is recorded in `safety_flags` (category, severity, IDs) and surfaced once;
5. `interpret_reading` streams via `runStreamObject`; partial layers are persisted every 1.2 s
   (`updateInterpretationPartial`) so a disconnect loses nothing; `card_id`s are resolved from
   the reading after validation (the model never writes them);
6. `complete` freezes the row (DB trigger) and supersedes any previous current row;
   any failure → `failed` with a class and whatever partial text arrived.

The route `POST /api/readings/[id]/interpret` returns the stored row as JSON when a current
interpretation exists (no call), attaches to an in-process live run (`src/interpretation/live.ts`,
replay + tail) when one is in flight, otherwise starts a run kept alive with `after()` and
streams SSE frames (`started · safety · text · reset · complete · failed`). `GET` returns state
for polling; `DELETE` cancels (row → `failed / cancelled`, partial layers kept).
`{ regenerate: true }` is the only way to call the model for a reading that already has a
current interpretation. Depth: `domain/interpretation/depth.ts` — `ai_explanation_depth` sets
length and `max_tokens` (1 100 / 1 800 / 2 800); `experienced` shortens one step and folds the
layers beneath the user's note.

## extract_reading_metadata — the run (Phase 06)

`src/memory/extract.ts` (`runExtraction`) is called by the `extract_reading_metadata` job;
`src/ai/tasks/extract_reading_metadata/` owns the prompt, schema re-export, versions and the
rule-based mock. Order of operations is the contract:

1. the reading exists and is not soft-deleted — it is usable before, during and after;
2. gates: `profiles.ai_consent_at` and the `ai_extraction` flag (env default off; per-user
   `user_flags` override) — no consent, no call of any kind, no row;
3. freshness: a current extraction at the same schema version, `metadata_version` and
   `source_hash` means nothing to do unless forced (notes edits change the hash; card, deck,
   spread and question edits bump the version);
4. an `extractions` row is written `pending` **before** the model call;
5. `runObject` with the Zod payload schema (`extraction/1.0.0`, strict, no probability field);
6. the pending row's payload is **materialised first** (`src/memory/materialize.ts`: themes onto
   the taxonomy, mentions through the resolver, entities/aliases/roles, predictions — with the
   user's overrides layered on), then the row is marked `complete` and the previous current
   row superseded in one transaction, so a reader never sees a complete extraction without its
   rows; a failed model call leaves a `failed` row with its class; timeouts and provider errors
   make the job retry, everything else is terminal.

The prompt sends the question, note, date, deck/spread names and the drawn cards as context
("never as evidence about the person's life"); the user's own `life_area` is passed as a hint.
Corrections never call the model: `src/memory/corrections.ts` writes an override as the user
and re-materialises. `reprocess_extractions {toSchema, userId?, limit}` walks readings whose
current extraction is not at the target schema and re-runs them, bounded, re-enqueueing
itself while work remains (`pnpm jobs:reprocess`).

Prompt context for later tasks takes entities only from `src/memory/context.ts`
(`auto` and `user` resolutions — never `tentative`, asserted by a test).

## extract_event_metadata and explain_correlation — the runs (Phase 08)

`src/events/extract.ts` (`runEventExtraction`) is the reading run's sibling with the same
six-step contract (exists and not deleted → consent + `ai_extraction` → freshness by
schema, `metadata_version` and the hash of description + note → `pending` row before the
call → validated payload → materialise-then-complete). The prompt sends the sentence, the
note and the date — nothing else. `event_type` and `importance` are promoted onto
`life_events`; entities and themes go through the same resolver and tables as a reading's.
The handler (`extract_event_metadata` job) queues the model-free `correlate_object` job
whatever the outcome, so an event without consent still gets `correlated_at` set and an
honest "nothing found".

`src/correlation/run.ts` (`correlateObject`) is **not** an AI task: it scores with
`domain/correlation` and writes `links`. For each newly offered link it queues
`explain_correlation`; `src/correlation/explain.ts` (`runExplainCorrelation`) gates on
consent and the flag, refuses rejected links, sends the two entries' own words plus the
band and the reasons (minimum context, §11), validates the sentence
(`explanationIssues`), and updates `explanation` + provenance only. The mock explainer
joins the reasons into one hedged sentence and adds nothing — which is what the real prompt
is told to do.

## parse_history_query and answer_from_evidence — the run (Phase 09)

`src/retrieval/ask.ts` (`askHistory`) is one generator per ask, driven by `POST /api/ask`
(server-sent events) and gated by consent and the `ask_my_history` flag. Order of operations
is the contract (docs/ALGORITHMS.md §4):

1. an `asks` row is written `pending` as the user **before** any model call;
2. `parse_history_query` (fast) on the question alone; a failure degrades to the empty parse
   plus `resolveTimePhrase`;
3. the question is embedded (the same embedder as retrieval documents; a failure degrades
   ranking to structure + recency); hints resolve through the user's aliases, journeys and
   the reference card search; `search_history()` narrows and scores in SQL **as the user**;
4. rank → augment (linked events, outcomes) → bound (≤ 24 objects, ≤ 6000 tokens, whole
   objects, dropped ids recorded);
5. an empty package is answered without a model call; otherwise `answer_from_evidence` (deep)
   receives the rendered package and nothing else (§11 minimum context) — the user's note is
   excerpted to 240 characters per object, entities are resolved ones only, links are
   confirmed / maybe only, interpretations and summaries never appear as facts;
6. `verifyAnswer` strips unknown labels; an uncited claim or a register violation triggers
   **one** repair turn (the failed JSON echoed with a content-free hint); still ungrounded →
   `insufficientAnswer` with what was found;
7. the row is completed through the service role (answer, claims and citations as object
   ids, sufficiency, package and dropped ids, model / prompt / schema versions, latency) and
   only then is the answer yielded. Stages stream before it so the screen can say what is
   happening; **no answer text streams before verification**. Cancelling ends the run at the
   next step boundary and marks the row `failed / cancelled`; a call in flight finishes on
   its own and is discarded.

Evidence grades (spec §19): a `confirmed` connection is the highest-grade evidence, `maybe`
is cited as maybe, `pending` and `rejected` never appear; outcomes are the user's records and
are cited by the reading they sit on. The mock parser and answerer (`tasks/*/mock.ts`) are
rule-based and answer the six §6.6 benchmark questions from the demo journal; the eval
(`pnpm eval`) runs the whole pipeline against the demo journal and treats an invented card
or date, an unverified citation or a false "sufficient" as a hard failure.

**Embeddings (Phase 09).** `src/retrieval/embed.ts` sends the stored `retrieval_documents.text`
and nothing else (asserted byte for byte), consent-gated, in batches of 16, and replaces stale
vectors (hash or model mismatch). The deterministic document builder is
`domain/retrieval/document.ts`; the `embed_object` job rebuilds and embeds one object, the
`backfill_embeddings` job walks a user (or every consenting user) and re-enqueues itself.

## Write gate

The mechanism behind invariant 7 / §9.2.

```ts
// src/domain/facts/writeGate.ts
const MODEL_ALLOWED: FactStatus[] = ['INFERRED_EVENT','TAROT_INTERPRETATION',
                                     'POSSIBILITY','SYSTEM_CORRELATION'];
```

- Every write that persists model-derived content goes through `modelWrite()`, which rejects any
  payload whose `fact_status` is outside `MODEL_ALLOWED`.
- `CONFIRMED_FACT` and `USER_REFLECTION` are reachable only via `userWrite()`, called from
  request handlers that carry a real user action.
- Backed by DB check constraints where the column is fixed (`interpretations.fact_status`,
  `predictions.fact_status`). Implemented in `src/domain/facts/writeGate.ts` (Phase 04); every
  interpretation write in `src/db/queries/interpretations.ts` goes through `modelWrite()`.
- Tables without a `fact_status` column (Phase 06: `entities`, `entity_aliases`,
  `entity_mentions`, `object_themes`, `entity_roles`) go through `modelBorn()`, which refuses
  `user_confirmed = true`, `source = 'user'` and any `resolution` other than `auto` /
  `tentative`. The materialiser routes every model-side insert through it (asserted
  structurally by the invariant test).
- Tests: attempt `CONFIRMED_FACT` through `modelWrite()` → rejected; promote an `INFERRED_EVENT` via
  user confirmation → allowed and audited; a model-authored link may never be born `confirmed`.
- Phase 08 tables: `life_events.fact_status` is `CONFIRMED_FACT | INFERRED_EVENT` by check with
  `confirmed_at` tied to it, and the RLS insert policy admits only confirmed user events from
  a session; `outcomes.recorded_by = 'user'` and `fact_status = 'CONFIRMED_FACT'` are fixed by
  check — no code path, not even the service role, can record an outcome for a model;
  `links.created_by ∈ {user, rule}` and a decided `state` ⇔ `user_acted_at`. The correlation
  run inserts `pending` rule rows only; the explainer touches prose columns only (both
  asserted structurally in `model-cannot-create-confirmed-fact`).
- Related invariant (§10 no self-validating loops): a `links` row may not use an `interpretation` or
  `period_summary` as its sole evidence for a real-life event. Enforced in the correlation engine —
  generated-provenance evidence is dropped before scoring — and asserted by
  `summary-never-sole-evidence`.

## Failure handling (§13 AI resilience)

| Failure | Behaviour |
|---|---|
| Invalid JSON / schema violation | One repair attempt (error + schema echoed back), then fail soft. `ai_calls.status='invalid_output'`. |
| Timeout | `standard`/`deep` 45s, `fast` 15s. Retry once at the same tier, then downgrade one tier, then fail soft. |
| 429 / 5xx | Exponential backoff with jitter, max 3 attempts; circuit breaker opens per provider for 60s after 5 consecutive failures. |
| Provider outage | Feature degrades: reading is already saved (transaction precedes AI); UI shows "Interpretation unavailable — retry" with a manual retry that re-enqueues. |
| Budget exceeded | `budget_denied`; user sees a clear limit message, never a crash; content still saves. |
| Refusal | Treated as a valid terminal state (`status: 'refusal'`), surfaced honestly, reading preserved. |

Implemented in `src/ai/run.ts` (Phase 00; streaming variant Phase 04) and tested branch-by-branch
in `src/ai/__tests__/run.test.ts` and `runStreamObject.test.ts` against the mock provider, and
end to end (row states, reading intact) in `src/__tests__/invariants/reading-survives-ai-failure.test.ts`
and `src/interpretation/__tests__/interpretation.integration.test.ts`. Timeout policy detail: the first timeout retries at the same tier, the
second downgrades one tier (`deep → standard → fast`), a third fails soft; at `fast` there is no
downgrade so it is retry-once-then-fail. Rate-limit backoff is `500ms · 2^n` ±50% jitter, capped
at 8s. The breaker counts 429/5xx/unknown failures across runs and, while open, returns
`errorClass: 'circuit_open'` without calling the provider.

Every branch is covered by a test using the mock provider's fault injection
(`mock.failWith('timeout' | 'invalid_json' | 'refusal' | '429')`).

## Versioning & reproducibility (§9.4)

- `PROMPT_VERSION` and `SCHEMA_VERSION` are bumped by hand in `version.ts` on any change; a CI check
  fails a PR that edits `prompt.ts` or `schema.ts` without bumping.
- Both versions plus `model_id` are persisted on every generated artifact.
- Reprocessing is a job: `reprocess_extractions --from-schema=3 --to=4` walks raw text forward.
  Superseded extractions are retained, not deleted, so a regression can be diagnosed.

## Cost controls (§13)

- Per-user budgets (**as built, Phase 11**): `DbBudgetPolicy` in `telemetry.ts` runs before
  every provider call in `runObject` / `runStream` / `runStreamObject`. It loads the user's
  subscription and this month's `usage_counters` through the one gate (`src/billing/gate.ts`
  → `domain/billing/entitlements.ts`) and denies with `budget_denied` and a reason (`plan`,
  `monthly`, `daily`) — the provider is never reached, the mock's call log proves it. Every
  task is metered under a feature (`TASK_FEATURE`): `interpret_reading` → the interpretation
  allowance (free 10 / premium 300 a month); `classify_safety` and `detect_repeat_question`
  → `support` (day cap only, so an interpretation costs one unit, not three); extraction,
  entity and journey proposals and retrieval documents → `memory` (free, cost-capped at
  300 / 1500); `explain_correlation`, `parse_history_query`, `answer_from_evidence`,
  `summarize_period`, `journey_narrative` → the premium analysis bucket (300 a month, 0 on
  free). A day cap (120 / 500 successful runs) sits under everything. Premium interpretations
  run on the `deep` tier (`modelHint`). Counters are written by `DbTelemetry` after every run
  that reached the provider: `calls` only on `ok`, tokens and cost regardless; a run with no
  `userId` is not metered. Embeddings do not go through the runner and are not metered. A
  failure to *read* the budget lets the call through and logs `ai.budget.check_failed`.
- Interpretations are immutable and cached — regeneration is explicit and metered.
- Retrieval context is hard-capped (max objects and max tokens); overflow drops lowest-ranked
  evidence rather than truncating mid-object.
- `ai_calls` powers cost-per-active-user and cost-per-task dashboards (§16). Written by
  `DbTelemetry` (`src/ai/telemetry.ts`, the one file in `src/ai/` allowed to touch the database)
  through the service-role surface; `/dev/ai-usage` reads it (calls, tokens, cost, p50/p95 latency,
  error classes by task and model). A telemetry failure is logged by class and never fails the run.

## Eval suite

`pnpm eval` (never in CI, costs money) runs `src/ai/tasks/*/fixtures/*.json` against the real provider
and checks: schema validity, deck-system purity, hedged register (banned-phrase scan), citation
integrity, and refusal-to-invent on deliberately evidence-poor fixtures. `pnpm eval --dry` runs the
same pipeline against the mock provider (proves the runner, costs nothing). Baselines live in
`src/ai/tasks/<task>/fixtures/__baselines__/` and are reviewed by a human on change.

Phase 09 fixtures: `parse_history_query/fixtures/benchmark.json` (eight questions: intent,
time range, life area, entities, axes) and eight `answer_from_evidence` fixtures — the six §6.6
benchmark questions and two adversarial ones (a person who never appears; a month with no
entries) — run end to end against the demo journal as `demo-ana` with expected-evidence
fragments, forbidden citations, sufficiency, invented-card / invented-date scans and the
register check. The section prints latency p95 and cost per ask from `ai_calls`.

Phase 04 fixtures: four `interpret_reading` readings (RWS three-card with a note, RWS Celtic cross
open reflection at `deep`, Thoth three-card for an `experienced` reader, Thoth one-card money
question) and seven `classify_safety` questions. Per interpretation the runner records: schema,
deck purity, register, positional specificity (each per-card text names its position or card),
note acknowledgement (a 3-gram of the note or an explicit reference appears), hedge density,
prompts end in a question mark, and the expected safety category. Each baseline file has a
`human_review` block to fill in — the "specific, not fortune-cookie" judgement (§3.3) is a
person's, not the script's.
