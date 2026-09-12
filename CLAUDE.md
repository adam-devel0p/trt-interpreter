# CLAUDE.md — Tarot Journal (working title: TRT Interpreter)

Read this file first, every session. It is short on purpose. Everything else lives in `docs/`.

## What this product is

A **private, low-friction tarot journal** that turns isolated readings into an evidence-backed
personal timeline: reading → themes → life events → outcome → evolving Journey.

It is **not** an AI tarot reader. AI is an optional interpretation and synthesis layer.
The differentiator is the reading-to-reality loop and explainable memory.

Source of truth for product requirements: [tarot_ai_product_requirements.md](tarot_ai_product_requirements.md)
(spec sections are cited as `§7.1`, `FR-09`, etc. throughout `docs/`).

## How work is organised

Work happens in **numbered phases**. Each phase is sized for one fresh Claude session and ends in a
runnable, fully tested state.

1. Read [docs/PROGRESS.md](docs/PROGRESS.md) to find the next phase and the state of the repo.
2. Read that phase's file in [docs/phases/](docs/phases/) end to end before touching code.
3. Read the completion reports of the phases it depends on, in [docs/phases/completed/](docs/phases/completed/).
4. Implement, then run the phase's **full** test plan. A phase is not done until every exit-criteria
   box is checked with real command output, not assumption.
5. Write the completion report from [docs/phases/_completion-report-template.md](docs/phases/_completion-report-template.md)
   into `docs/phases/completed/phase-NN-report.md`, update `docs/PROGRESS.md`, and update any
   `docs/` file whose contract you changed (schema, AI tasks, algorithms, design system).
6. **Do not commit or push.** The user handles all git operations manually. Leave the working tree
   clean of stray files and tell the user what changed.

Never start a phase before its prerequisites are marked complete in `docs/PROGRESS.md`.
Never silently expand a phase's scope — note the finding in the completion report's *Deferred* section.

## Product invariants — never violate these (spec §21)

1. Longitudinal journal first, AI tarot reader second.
2. Physical and digital drawing are both first-class. Physical readers are not second-class citizens.
3. RWS and Thoth are both first-class deck systems. `deck_id` is persisted on every reading; card
   identity, names, court structure and meanings are deck-native. **Thoth is never rendered as
   alternate RWS artwork or given RWS meanings.**
4. Raw user text is never discarded or overwritten. AI metadata is derived, versioned and
   reprocessable.
5. Entities have stable IDs. Aliases are not identities. Roles are temporal (`valid_from`/`valid_to`).
6. Journeys are evolving subjects, not tags.
7. `CONFIRMED_FACT` can only be created by user input or user confirmation. **Generated text can
   never produce a confirmed fact.** (spec §9.2)
8. Correlation is evidence-based, confidence-scored and reversible.
9. Every historical AI claim carries source object IDs, or says evidence is insufficient.
10. The user never maintains the knowledge graph by hand.
11. The archive stays readable regardless of subscription status. Never paywall existing user text.
12. Privacy is a product feature: backend-only LLM calls, minimum context, no raw journal content in
    logs or analytics, real delete and export.
13. No compulsive mechanics, no fake certainty scores, no gamified streak pressure.

## Engineering rules

- **Stack**: Next.js 15 (App Router, TS strict) · Supabase Postgres + RLS + pgvector + Auth + Storage
  · Drizzle for schema/migrations · Tailwind + shadcn/ui · Vitest + Playwright · Vercel.
- **Every user-owned table has RLS enabled and a policy keyed on `auth.uid()`.** A new table without
  an RLS policy and an RLS test is an incomplete change.
- **All LLM/embedding calls go through `src/ai/`** and only ever run server-side. No provider key
  reaches the client. No direct `fetch` to a model provider anywhere else in the tree.
- **Writes are transactional before AI.** A reading or life event is persisted and usable before any
  model call. AI failure degrades the experience; it never loses content.
- **Opening saved content makes zero AI calls.** Generated artifacts are stored, not recomputed.
- Persist `model_id`, `prompt_version`, `schema_version` on every generated artifact.
- Structured model output is validated with Zod; invalid output retries then fails soft.
- No raw journal text in logs, error reports or analytics events. Log object IDs.
- Mobile-first. Test at 390px width. Accessibility is a requirement, not a polish item:
  keyboard navigation, semantic labels, AA contrast, scalable text, `prefers-reduced-motion`.
- Taxonomy keys are stable machine strings; display labels are localisable and separate (spec §13).

## Commands

```bash
pnpm dev              # Next.js dev server
pnpm supabase:start   # local Supabase stack (Docker)
pnpm db:migrate       # apply migrations
pnpm db:seed          # deck/spread reference data (idempotent)
pnpm demo:seed        # generate a fictional multi-month journal for UI testing
pnpm test             # Vitest unit + integration
pnpm test:rls         # authorization / row-level-security suite
pnpm test:e2e         # Playwright
pnpm eval             # prompt evals against real models (never in CI, costs money)
pnpm lint && pnpm typecheck
```

## Tone of the product surface

Reflective, plain, specific. "suggests", "may point to", "one way to read this" — never deterministic
prediction, never supernatural certainty, never invented accuracy statistics. Tarot interpretation is
reflection and entertainment; medical, legal, financial, self-harm and safety topics get redirected to
qualified help while keeping the reflection available (spec §10).
