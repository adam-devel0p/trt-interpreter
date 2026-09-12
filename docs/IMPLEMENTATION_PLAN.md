# Implementation Plan — Tarot Journal

Derived from [tarot_ai_product_requirements.md](../tarot_ai_product_requirements.md).
This is the master document. Per-phase instructions live in [phases/](phases/).

- Current state and next phase: [PROGRESS.md](PROGRESS.md)
- Schema: [DATA_MODEL.md](DATA_MODEL.md)
- AI layer contracts: [AI_LAYER.md](AI_LAYER.md)
- Algorithms and thresholds: [ALGORITHMS.md](ALGORITHMS.md)
- Privacy, deletion, export: [PRIVACY_AND_DELETION.md](PRIVACY_AND_DELETION.md)
- Test strategy: [TESTING.md](TESTING.md)
- UX foundations: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)

---

## 1. Tech stack and why

| Layer | Choice | Justification | Trade-off accepted |
|---|---|---|---|
| App framework | **Next.js 15, App Router, TypeScript strict** | One codebase for the mobile-first PWA (§2) and the server boundary that must hold all LLM keys (§11). RSC keeps journal browsing fast without client-side data waterfalls; route handlers give streaming AI responses. Also gives the SEO reference pages of §15.1 for free. | Vendor-shaped deployment story; React Server Component mental overhead. |
| Database | **Supabase Postgres** | Relational is the right fit: the domain is a typed graph of readings/entities/journeys/links with strict per-user authorization. Postgres gives transactions (§13 reliability), `pgvector` for semantic retrieval, `pg_trgm` for alias matching and full-text search for the journal — one store instead of three. | Postgres vector search is good, not best-in-class; revisit only if per-user corpora exceed ~100k objects. |
| Authorization | **Supabase Auth + Postgres RLS** | §11 requires managed auth ("never build password storage manually") and database-level row policies. RLS makes user isolation a property of the database, not of remembering a `where user_id` in every query. | RLS policies must be written and tested for every table; service-role code paths need care. |
| Schema/migrations | **Drizzle ORM + SQL migrations** | Typed queries from the same TS types the API uses; migrations are plain reviewable SQL, so RLS policies, indexes, constraints and enums live in version control next to the code. | Less magic than Prisma; some raw SQL for vector and FTS queries. |
| UI | **Tailwind + shadcn/ui + Radix primitives** | Radix gives keyboard/focus/ARIA behaviour that §13 accessibility demands without hand-rolling it. shadcn components are owned source files, so the visual language can be pushed away from generic-AI-app defaults. | Must actively theme it or the app looks like every other shadcn app. |
| Animation | **Framer Motion**, gated on `prefers-reduced-motion` | Shuffle/reveal and timeline transitions need to feel crafted but skippable (§6.2). | Bundle cost; keep it off the journal list path. |
| Generation model | **Claude** via the Anthropic API, behind an adapter | Strong long-context synthesis and structured output for interpretation, extraction and evidence-grounded answers. | Single-vendor generation until a second adapter is written; adapter interface prevents lock-in. |
| Embeddings | **OpenAI `text-embedding-3-small` (1536d)**, behind the same adapter | Anthropic exposes no embeddings endpoint. Only the short, sanitised *retrieval document* (§8.3) is sent — never raw journal prose — which limits the second-vendor exposure. Documented in the privacy page. | Second processor to disclose. Swappable for a self-hosted model later; `embeddings.model`/`version` columns make re-embedding a migration, not a rewrite. |
| Validation | **Zod** everywhere (model output, API input, env) | §13 AI resilience requires structured output validation with retry/fallback. | — |
| Payments | **Stripe Checkout + webhooks** (web-first) | §14 needs trials, monthly + annual. RevenueCat only becomes relevant if native apps ship. | Store-billing rework if native apps arrive. |
| Background work | **Supabase `pg_cron` + a `jobs` table with a worker route** (Vercel cron) | Extraction, embedding, summaries and purges must be retryable and out of the request path. Avoids a second infra dependency at this size. | Not a real queue; revisit if throughput demands it. |
| Observability | **Structured JSON logs + `ai_calls` table + Sentry with content scrubbing** | §13 wants latency/tokens/error-class/model-version/object-IDs and explicitly no raw journal content. A DB table makes cost telemetry queryable per user and per task. | Sentry needs an aggressive `beforeSend` scrubber and a test proving it. |
| Testing | **Vitest** (unit + integration against local Supabase), **dedicated RLS suite**, **Playwright** (E2E + axe), **`pnpm eval`** prompt evals | §20 asks for unit, integration, authorization, prompt/eval and E2E tests as separate concerns. | Local Supabase in CI is slower than mocks; worth it for RLS truth. |

### Rejected alternatives, briefly

- **Firebase/Firestore** — the relational graph and evidence joins would become application-level
  glue, and there is no in-store vector search.
- **A separate vector database** — a third store to keep consistent with deletion (§11 requires
  derived data to die with the parent). `pgvector` deletes by foreign key.
- **Client-side/on-device models** — attractive for the privacy positioning, but incompatible with the
  hybrid retrieval architecture the product is built on (§17 defers E2EE for exactly this reason).
- **Expo/React Native first** — §2 says mobile-first web/PWA first, native after validation.

---

## 2. Architecture

```
apps/web (Next.js)
├─ app/(marketing)          public SEO pages: card & spread reference (§15.1)
├─ app/(auth)               sign in / sign up / onboarding (§6.1)
├─ app/(app)                authenticated product shell
│  ├─ home                  fast start + one retrospective insight
│  ├─ journal               timeline, search, filters, reading detail
│  ├─ journey/[id]          the differentiating screen (§6.5)
│  ├─ ask                   Ask My History (§6.6)
│  └─ profile               privacy, decks, reminders, subscription, export/delete
├─ app/api/…                route handlers: AI streaming, jobs worker, stripe webhook
│
src/
├─ domain/                  pure TS: types, fact-status rules, scoring, no I/O  ← heaviest test coverage
│  ├─ readings/  decks/  entities/  journeys/  correlation/  retrieval/
├─ db/                      drizzle schema, migrations, query modules, RLS helpers
├─ ai/                      THE ONLY place that talks to model providers
│  ├─ provider.ts           interface: generateObject / generateStream / embed
│  ├─ providers/            anthropic.ts · openai-embeddings.ts · mock.ts
│  ├─ tasks/<task>/         prompt.ts · schema.ts · version.ts · index.ts
│  ├─ registry.ts           task → {model route, prompt_version, schema_version}
│  └─ telemetry.ts          writes ai_calls, enforces budgets
├─ jobs/                    enqueue + handlers (extract, embed, summarize, purge, correlate)
├─ flags/                   feature flags, per-user rollout
└─ ui/                      design system + composite components
```

**Layering rule.** `domain/` never imports `db/` or `ai/`. `ai/` never imports `db/` except through
`telemetry.ts`. Route handlers orchestrate: validate → persist → enqueue → respond. This is what makes
"reading saved before AI" structurally true rather than a convention.

### Request lifecycle for a reading (the critical path)

```
POST /api/readings
  1. Zod-validate input                        (fails fast, nothing written)
  2. TRANSACTION: readings + reading_cards     ← user content is now safe (§13 reliability)
  3. respond 201 with reading id               ← UI navigates immediately
  4. enqueue: interpret → extract → embed → correlate
  5. client subscribes to the interpretation stream
     └─ AI failure → reading shows "interpretation unavailable, retry" and stays fully usable
```

---

## 3. Cross-cutting strategies

Each of these has a dedicated document; summarised here so the shape is visible in one place.

1. **Fact-status model** (§9.2) — a `fact_status` enum plus a *write gate*: model-originated writes
   may only produce `INFERRED_EVENT`, `TAROT_INTERPRETATION`, `POSSIBILITY`, `SYSTEM_CORRELATION`.
   `CONFIRMED_FACT` and `USER_REFLECTION` are reachable only from user-action endpoints. Enforced in
   code and by DB check constraints, with tests that attempt the violation. → [AI_LAYER.md](AI_LAYER.md)
2. **Versioned derived metadata** (§7.2) — raw text is immutable; extractions are append-only rows
   carrying `schema_version` + `model_id`, superseding earlier ones. Reprocessing history under a new
   schema is a job, not a migration. → [DATA_MODEL.md](DATA_MODEL.md)
3. **Entity resolution** (§7.1) — candidate generation (exact/normalised alias, trigram, embedding)
   → deterministic scoring → auto-link ≥ 0.85, tentative 0.60–0.85, disambiguate only when the
   distinction changes history. Merge/split re-evaluates dependents. → [ALGORITHMS.md](ALGORITHMS.md)
4. **Journey assignment** (§6.5) — auto-create on strong evidence, suggest on ambiguity, never require
   manual organisation. → [ALGORITHMS.md](ALGORITHMS.md)
5. **Correlation scoring** (§8.2) — weighted multi-signal score; card/symbol overlap can never be
   sufficient alone; < 0.55 stays invisible; only user confirmation yields `confirmed`; rejections are
   remembered by evidence fingerprint so they are not re-suggested without materially new evidence.
   → [ALGORITHMS.md](ALGORITHMS.md)
6. **Hybrid retrieval** (§8.1) — parse → structured narrow → semantic rank over compact retrieval
   documents → augment with events/outcomes/summaries → bounded evidence package → answer whose
   citations are validated against the package. → [ALGORITHMS.md](ALGORITHMS.md)
7. **Privacy, deletion, export** (§11, FR-22/23) — one deletion registry declares every derived
   artifact of every object type; `pnpm test` asserts the registry covers all tables. → [PRIVACY_AND_DELETION.md](PRIVACY_AND_DELETION.md)
8. **Feature flags** — `ai_extraction`, `entity_resolution`, `journey_autocreate`,
   `correlation_suggestions`, `ask_my_history`, `period_summaries`, `share_cards`, `physical_photo_ocr`.
   Default off in production until each phase's evals pass; per-user overrides for beta cohorts.
9. **Cost controls** (§13) — per-task model routing (cheap model for extraction/classification,
   strong model for interpretation and historical synthesis), per-user daily/monthly token budgets,
   immutable-interpretation caching, bounded retrieval context, `ai_calls` cost telemetry with alerts.
10. **Demo data** (§20) — `pnpm demo:seed` generates a coherent fictional 6-month history (readings
    across both decks, life events, journeys, outcomes, confirmed and rejected links) so longitudinal
    UI is testable in a fresh database. **Every phase that adds a longitudinal object extends this
    generator.** Non-negotiable: without it, phases 7–12 cannot be tested at all.

---

## 4. Phase map

Each phase is one fresh session, independently testable, ending runnable. `Deps` lists phases that
must be complete first.

| # | Phase | Deps | Outcome you can demo | Spec |
|---|---|---|---|---|
| [00](phases/phase-00-foundations.md) | Foundations & rails | — | App boots, local DB, CI green, design tokens, RLS + AI test harnesses proven on a throwaway table | §18 P0 |
| [01](phases/phase-01-auth-onboarding.md) | Auth, profile, onboarding | 00 | Sign up → 4-step onboarding → profile with deck/reversal/AI-consent settings; cross-user isolation proven | FR-01, §6.1 |
| [02](phases/phase-02-deck-reference.md) | Deck reference layer: RWS + Thoth | 00 | 156 cards seeded with deck-native names/meanings/correspondences, archetype map, cross-deck search aliases, public card reference pages, 5 spreads | FR-03A/B/C, §6.7 |
| [03](phases/phase-03-reading-loop.md) | Reading loop (no AI) | 01, 02 | Ask a question → pick spread/deck → digital draw **or** physical entry → notes → saved reading detail, all without a model call | FR-02–05, §6.2 |
| [04](phases/phase-04-ai-interpretation.md) | AI boundary + layered interpretation | 03 | Streaming deck-aware layered interpretation, versioned + cached; provider outage still saves the reading; safety + repeat-question handling | FR-06, §9, §10 |
| [05](phases/phase-05-journal-search.md) | Journal, search, edit, export v1 | 04 | Timeline, filters, full-text + card/date/spread search, editable notes, real delete, JSON export | FR-07, 21–23, §6.3 |
| [06](phases/phase-06-structured-memory.md) | Extraction, entities, aliases, corrections | 05 | Readings auto-extract themes/entities/predictions; stable entities with aliases and temporal roles; merge/split; user corrections win | FR-08, 09, 26, 27, §7 |
| [07](phases/phase-07-journeys.md) | Journeys | 06 | Journeys auto-created/suggested; Journey screen with interleaved timeline, theme progression, cross-deck card identity preserved | FR-10, 16, 17, §6.5 |
| [08](phases/phase-08-events-outcomes.md) | Life events, outcomes, correlation engine | 07 | One-sentence life event → extraction → 1–3 scored suggested links → confirm/maybe/reject; revisit windows and outcome status | FR-11–15, §6.4, §8.2 |
| [09](phases/phase-09-retrieval-ask.md) | Hybrid retrieval + Ask My History | 08 | Natural-language questions over personal history with tappable citations and an honest "not enough evidence" | FR-18, 19, §8 |
| [10](phases/phase-10-summaries-retrospectives.md) | Summaries, recurring symbols, retrospectives | 09 | Journey narrative header, contextual recurring symbols, weekly/monthly retrospectives with provenance, on-this-day resurfacing | FR-20, §6.5, §15.2 |
| [11](phases/phase-11-monetization-retention.md) | Metering, subscription, reminders, share cards | 10 | Usage limits, Stripe trial→paid, paywall that never blocks existing text, revisit reminders, privacy-safe share cards | FR-24, 28, §14, §15 |
| [12](phases/phase-12-hardening-beta.md) | Hardening, privacy audit, a11y, evals, beta | 11 | Security + privacy review passed, a11y audit, prompt eval suite, load/cost test, analytics dashboards, beta cohort ready | §18 P7, §19, §22 |

### Dependency graph

```
00 ──┬── 01 ──┐
     └── 02 ──┴── 03 ── 04 ── 05 ── 06 ── 07 ── 08 ── 09 ── 10 ── 11 ── 12
```

Phases 01 and 02 are independent of each other and may be done in either order (02 is a good
low-risk session; 01 unblocks everything else). From 03 onward the chain is strictly linear because
each phase consumes the previous phase's persisted objects.

### Checkpoints worth stopping at

- **After 05** — a genuinely useful private tarot journal with AI interpretation. Shippable alone.
- **After 09** — every experience in §17's MVP list exists and its hypothesis ("users value tarot more
  when the app remembers and connects readings over time") is testable end to end. §17's remaining MVP
  item — minimal subscription/metering plumbing — is in Phase 11 and is not needed for the study.
  **Run the §22 validation with 10–20 users here, before building 10–12.**
- **After 12** — beta-ready.

---

## 5. Definition of done, every phase

A phase is complete only when all of the following are true:

- [ ] Every task in the phase file is implemented, or explicitly listed as deferred with a reason.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm test:e2e` all pass, and the
      output is pasted into the completion report.
- [ ] Every new user-owned table has RLS enabled, a policy, and a test proving user B cannot read,
      write or delete user A's row.
- [ ] The phase's UX acceptance criteria are verified at 390px width **and** with keyboard only.
- [ ] Manual verification steps in the phase file were actually performed, with observed results.
- [ ] `pnpm demo:seed` still runs on a fresh database and now exercises the new objects.
- [ ] No raw journal content appears in logs or analytics for the new code paths (grep + test).
- [ ] Completion report written to `docs/phases/completed/phase-NN-report.md`, `docs/PROGRESS.md`
      updated, and every `docs/` contract touched by the phase updated in the same session.
