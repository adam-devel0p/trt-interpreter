# Tarot Journal (working title: TRT Interpreter)

A private, low-friction tarot journal that turns isolated readings into an evidence-backed personal
timeline. Not an AI tarot reader: AI is an optional interpretation and synthesis layer.

- Product requirements: [tarot_ai_product_requirements.md](tarot_ai_product_requirements.md)
- Working rules for every session: [CLAUDE.md](CLAUDE.md)
- Plan, schema, AI contracts, algorithms, privacy, tests, design: [docs/](docs/)
- Where we are: [docs/PROGRESS.md](docs/PROGRESS.md)

## Setup on a fresh machine

Requirements: Node ≥ 22, [pnpm](https://pnpm.io) (`corepack enable`), Docker (for the local
Supabase stack), the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
git clone <repo> && cd trt-interpreter
pnpm install
cp .env.example .env.local
pnpm supabase:start            # boots Postgres/Auth/Storage/Studio in Docker (ports 55321–55329)
pnpm supabase:status           # prints keys — copy ANON_KEY and SERVICE_ROLE_KEY into .env.local
pnpm db:migrate                # applies src/db/migrations
pnpm db:seed                   # deck/spread reference data (RWS + Thoth), idempotent
pnpm dev                       # http://localhost:3000
```

Ports are deliberately non-default (`55321` API, `55322` Postgres, `55323` Studio) so this project
can run alongside another local Supabase project. `.env.example` already points at them.

First-time Playwright: `pnpm exec playwright install chromium`.

Auth runs on Supabase Auth. Email/password and magic links work out of the box locally (mail lands
in Mailpit at `http://127.0.0.1:55324`). Google sign-in needs
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` exported before `pnpm supabase:start`
(see `.env.example`); without them the button shows a neutral "not available" message.
`pnpm demo:seed` creates `demo-ana@tarot.local` / `demo-ben@tarot.local` / `demo-cleo@tarot.local`
(password `demo-password-123`) with onboarding complete — Ana consented to AI, Ben declined, and
Cleo carries a generated 1000-reading journal (`--bulk N`, default 1000) for the journal's
performance and scroll checks. Delete + export run their jobs straight away; `pnpm jobs:run`
is the retry path.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server / production build / serve the build |
| `pnpm supabase:start` / `supabase:stop` / `supabase:status` | Local Supabase stack |
| `pnpm db:migrate` | Apply Drizzle SQL migrations from `src/db/migrations` |
| `pnpm db:generate` | Generate a migration from `src/db/schema` (then review the SQL, add RLS) |
| `pnpm db:seed` | Deck/spread reference data (156 cards, archetypes, aliases, 5 spreads), idempotent |
| `pnpm art:build` | Re-encode the public-domain RWS scans into `public/cards/rws` (outputs are committed; only needed when the pipeline changes) |
| `pnpm demo:seed --months 6 --bulk 1000` | Fictional multi-month journal for UI testing (extended every phase); `--bulk` sizes demo-cleo's generated journal |
| `pnpm jobs:run` | Process one batch of background jobs locally (stands in for Vercel cron) |
| `pnpm jobs:summaries` / `jobs:reminders` | Queue and run the summary sweep / the reminder sweep (local stand-ins for the hosted cron) |
| `pnpm notifications:keys` | Print a fresh VAPID key pair for Web Push (`VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) |
| `pnpm test` | Vitest unit **and** integration suites (integration needs Supabase running) |
| `pnpm test:unit` / `test:integration` | Either suite alone |
| `pnpm test:rls` | Authorization suite: real users, real JWTs, row-level-security assertions |
| `pnpm test:e2e` | Playwright (mobile 390px + desktop) with axe; runs against `pnpm build` |
| `pnpm eval` | Prompt evals against real models — never in CI, costs money (`--dry` runs them against the mock) |
| `pnpm lint` | ESLint (incl. architecture rules) + Prettier + deletion-registry check |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check:client-bundle` | After a build: fail if the client bundle contains a secret |
| `pnpm check:prompt-versions` | Fail if a prompt/schema changed without a version bump |

The full gate, in CI order:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm test:e2e
```

## Layout

```
app/                      Next.js App Router: (marketing) (auth) (app) api/ dev/
src/
  config/                 env.ts (client-safe) · env.server.ts (server-only, Zod-validated)
  domain/                 pure TS — no db, ai, framework or I/O imports (lint-enforced)
  db/                     schema/ migrations/ client.ts (RLS) · admin/ (service role, narrow surface)
  ai/                     the ONLY place that talks to model providers: provider.ts run.ts registry.ts
  jobs/                   enqueue.ts worker.ts handlers/
  flags/                  feature flags (env default → user override → dev session)
  observability/          content-free logger, Sentry scrubber
  ui/                     tokens.css, components/, motion
  __tests__/              rls harness, integration setup, invariants/ (one file per §21 invariant)
scripts/                  migrate, seeds, eval, CI checks
e2e/                      Playwright specs
supabase/                 local stack config
```

Architecture rules are enforced by ESLint (`eslint.config.mjs` + `eslint/local-rules.mjs`):
`domain/` cannot import `db/`/`ai/`/framework code; provider SDKs only inside `src/ai/`; the
service-role client only inside `src/db/admin/`; server env cannot be imported from a `'use client'`
file; no hard-coded colours in UI code.

## Phase workflow

Work is organised in numbered phases, each sized for one session and ending in a runnable,
fully tested state. Read [CLAUDE.md](CLAUDE.md), then [docs/PROGRESS.md](docs/PROGRESS.md) for the
next phase, then that phase's file in [docs/phases/](docs/phases/). Each phase ends with a completion
report in `docs/phases/completed/`. Git operations are done by hand.

## Dev-only pages

- `/dev/ui` — component gallery, light/dark, RWS/Thoth accents
- `/dev/flags` — toggle feature flags for this browser session
- `/api/health` — DB reachable, migrations current, provider configured (no model call)

## Deploying

Vercel. Set every variable from `.env.example`, plus `CRON_SECRET` equal to `JOBS_RUN_SECRET` so
the cron in `vercel.json` can call `/api/jobs/run`. Migrations run from CI/CLI (`pnpm db:migrate`),
never at boot.
