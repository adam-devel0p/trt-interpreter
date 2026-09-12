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

## Task catalogue

Each task is a directory `src/ai/tasks/<task>/` containing `prompt.ts`, `schema.ts`,
`version.ts` (`PROMPT_VERSION`, `SCHEMA_VERSION`), `index.ts`, and `fixtures/` for evals.

| Task | Phase | Tier | Output | Notes |
|---|---|---|---|---|
| `interpret_reading` | 04 | deep | layered interpretation | Deck-aware; streams; grounded in `cards` reference rows, not model memory |
| `classify_safety` | 04 | fast | category + severity | Runs on the question before interpretation (§10) |
| `detect_repeat_question` | 04 | fast (embedding + rule) | similarity verdict | Mostly deterministic; no generation needed (FR-25) |
| `extract_reading_metadata` | 06 | standard | extraction payload | Themes, entities, possibilities, timeframe (§7.2) |
| `extract_event_metadata` | 08 | standard | extraction payload | Same schema family as above (§6.4) |
| `propose_entity_candidates` | 06 | fast | candidate mentions + aliases | Proposes only; resolution decided in `domain/` |
| `propose_journey` | 07 | standard | title + confidence + rationale | Naming only; assignment decided in `domain/` |
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
   Thoth criterion mechanically testable.
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
  `predictions.fact_status`).
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

Implemented in `src/ai/run.ts` (Phase 00) and tested branch-by-branch in `src/ai/__tests__/run.test.ts`
against the mock provider. Timeout policy detail: the first timeout retries at the same tier, the
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
- `ai_calls` powers cost-per-active-user and cost-per-task dashboards (§16).

## Eval suite

`pnpm eval` (never in CI, costs money) runs `src/ai/tasks/*/fixtures/*.json` against the real provider
and checks: schema validity, deck-system purity, hedged register (banned-phrase scan), citation
integrity, and refusal-to-invent on deliberately evidence-poor fixtures. `pnpm test` runs the same
fixtures against the mock provider for determinism. Baselines live in
`src/ai/tasks/<task>/fixtures/__baselines__/` and are reviewed by a human on change.
