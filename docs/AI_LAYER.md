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
(plain `fetch` to `/v1/embeddings`, question text only), `mock.ts` (fixtures may be functions of
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
| `extract_event_metadata` | 08 | standard | extraction payload | Same schema family as above (§6.4) |
| `propose_entity_candidates` | 06 (folded) | fast | — | Folded into `extract_reading_metadata`'s `entities[]` (one call per save instead of two); resolution is decided in `domain/entities/resolve.ts`. The `TaskId` stays reserved. |
| `propose_journey` | 07 ✅ | standard | title + rationale + confidence band | Naming only; assignment decided in `domain/journeys`. Runs as the `propose_journey` job after discovery (consent + `journey_autocreate`), never in the request path; a user rename pins the title (`title_source = 'user'`); `low` confidence keeps the placeholder. Context is the minimum (§11): dates, questions, resolved entities from `entityContextForObjects`, theme labels — no notes. `propose_journey/1.0.0` · `journey_proposal/1.0.0` |
| `explain_correlation` | 08 | fast | 1–2 sentence reason | Explains a score the code computed; may not invent the link |
| `parse_history_query` | 09 | fast | intent, time range, entities, journey hints | Step 1 of §8.1 |
| `answer_from_evidence` | 09 | deep | answer + citations + sufficiency | Citations validated against the package |
| `summarize_period` | 10 | standard | summary + highlights + source IDs | Source IDs must be a subset of inputs |
| `journey_narrative` | 10 | standard | one-sentence header + progression labels | §6.5 narrative header |
| `build_retrieval_document` | 09 | fast | compact §8.3 text | Deterministic template first, model only to compress |

**Model routing** (`registry.ts`, overridable per-environment via `AI_MODEL_FAST/STANDARD/DEEP`):
`fast` → `claude-haiku-4-5` · `standard` → `claude-sonnet-5` · `deep` → `claude-opus-5`.
Embeddings → `text-embedding-3-small`. Routing is data, asserted by a test that every `TaskId` has a
tier and every tier has a model.

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
- Related invariant (§10 no self-validating loops): a `links` row may not use an `interpretation` or
  `period_summary` as its sole evidence for a real-life event. Enforced in the correlation builder and
  asserted by a test.

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

- Per-user budgets: free tier daily/monthly caps, premium higher; enforced in `telemetry.ts` before
  the provider call, recorded in `usage_counters`.
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

Phase 04 fixtures: four `interpret_reading` readings (RWS three-card with a note, RWS Celtic cross
open reflection at `deep`, Thoth three-card for an `experienced` reader, Thoth one-card money
question) and seven `classify_safety` questions. Per interpretation the runner records: schema,
deck purity, register, positional specificity (each per-card text names its position or card),
note acknowledgement (a 3-gram of the note or an explicit reference appears), hedge density,
prompts end in a question mark, and the expected safety category. Each baseline file has a
`human_review` block to fill in — the "specific, not fortune-cookie" judgement (§3.3) is a
person's, not the script's.
