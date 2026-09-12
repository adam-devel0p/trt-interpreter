# Phase 00 — Foundations & Rails

**Deps:** none · **Spec:** §18 Phase 0, §11, §13 · **Outcome:** the app boots locally and in CI with a
real database, a proven RLS test harness, a proven AI mock harness, the design system, and the job
runner — all demonstrated on a throwaway table so later phases inherit working rails.

> Read [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), [../../CLAUDE.md](../../CLAUDE.md) and
> [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) before starting. This phase writes no product features on
> purpose: its whole value is that every later phase can be tested.

## Scope

**In:** repo + tooling, Next.js app skeleton, Supabase local + migrations, Drizzle, design tokens and
base components, AI boundary interfaces with mock provider only, job runner, observability, feature
flags, env validation, CI, all five test suites wired and green.

**Out:** auth UI (01), any deck data (02), any real provider call (04).

## Tasks

### 1. Repo and tooling
- `pnpm` project, TypeScript **strict** (`noUncheckedIndexedAccess` on), ESLint + Prettier.
- Next.js 15 App Router, React 19, route groups `(marketing)` `(auth)` `(app)` per
  [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md#2-architecture).
- Directory skeleton exactly as the architecture section specifies, including `src/domain/`,
  `src/db/`, `src/ai/`, `src/jobs/`, `src/flags/`, `src/ui/`.
- **Layering lint rule** (`eslint-plugin-boundaries` or import/no-restricted-paths): `domain` may not
  import `db`/`ai`/`next`; nothing outside `src/ai/` may import a provider SDK; service-role client
  only importable from `src/db/admin/`. This rule is what keeps the architecture honest — write it now.
- `pnpm scripts` exactly as listed in [../../CLAUDE.md](../../CLAUDE.md#commands) (some will be
  no-op stubs this phase, but they must exist and exit 0).

### 2. Environment and config
- `src/config/env.ts`: Zod-validated env, separate `server` and `client` objects. Importing the server
  object from client code is a lint error. Missing var = loud startup failure, never a silent undefined.
- `.env.example` documenting every var with a comment. No real secrets in the repo.

### 3. Database
- `supabase/` local stack; `pnpm supabase:start` documented for a fresh machine (Docker required).
- Enable extensions: `pgcrypto`, `pg_trgm`, `vector`, `pg_cron` (+ note if pg_cron is unavailable locally).
- Drizzle config, migration folder, `pnpm db:migrate`.
- Migration `0001_platform`: all enums from [../DATA_MODEL.md](../DATA_MODEL.md#enums), plus the
  `jobs` table, plus a **throwaway `smoke_notes` table** (`id`, `user_id`, `body`) used only to prove
  the RLS harness. Delete `smoke_notes` in Phase 01 once a real table exists.
- `src/db/client.ts` (anon/user client, RLS-respecting) and `src/db/admin/client.ts` (service role,
  narrow surface, lint-guarded).

### 4. AI boundary — interfaces and mock only
- `src/ai/provider.ts` with the interface from [../AI_LAYER.md](../AI_LAYER.md#provider-interface).
- `src/ai/registry.ts`: `TaskId` union (all tasks from the catalogue, even unimplemented), tier map,
  model-ID map read from env. Test: every `TaskId` resolves to a tier and every tier to a model ID.
- `src/ai/providers/mock.ts`: deterministic canned responses keyed by task + fixture name, plus
  `failWith('timeout'|'invalid_json'|'refusal'|'429')` fault injection.
- `src/ai/telemetry.ts`: writes `ai_calls` (created in Phase 04 — stub the write behind an interface
  now), enforces a budget hook (no-op until Phase 11).
- `src/ai/run.ts`: the single call wrapper implementing retry/repair/timeout/circuit-breaker policy.
  **Implement the policy now with the mock provider and test every branch.** Phase 04 then only adds a
  real provider behind an already-tested policy.

### 5. Jobs
- `jobs` table + `src/jobs/enqueue.ts`, `src/jobs/worker.ts`, handler registry.
- `POST /api/jobs/run` protected by a shared secret, processes a bounded batch, exponential backoff,
  `max_attempts` then `dead`. Vercel cron config + local `pnpm jobs:run`.
- One trivial handler (`noop_echo`) with an integration test covering success, retry and dead-letter.

### 6. Observability
- `src/observability/logger.ts`: structured JSON, request ID, user ID, **content-free by
  construction** — the log function's type only accepts a whitelisted props shape, so passing journal
  text is a type error rather than a review catch.
- Sentry with `beforeSend` scrubbing request bodies and known content fields; test asserts a payload
  containing a `user_notes` field is scrubbed.
- `/api/health`: DB reachable, migrations current, provider configured (no call made).

### 7. Feature flags
- `src/flags/` with the flag list from [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md#3-cross-cutting-strategies),
  resolved from env defaults → `user_flags` override (table lands in 01; read path tolerates absence).
- `flag()` is server-side; a dev-only `/dev/flags` page toggles for the current session.

### 8. Design system (§4, [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md))
- Tailwind configured against `src/ui/tokens.css`; full light palette on `:root`, dark overrides,
  deck-accent token sets swapped by `data-deck`. **No component may hard-code a colour** — lint or
  review check.
- Fonts: one content serif + one UI sans, self-hosted, `font-display: swap`, with real fallback stacks.
- Base components: `AppShell`, `BottomNav` (5 tabs, routes stubbed), `PageHeader`, `Skeleton`,
  `EmptyState`, `ErrorState`, `ConfirmDestructive`, `InferredChip`, `ConfidenceBadge`.
- `/dev/ui` gallery rendering every component in light + dark at 390px and desktop.
- PWA: manifest, icons, offline shell for the app chrome (not content yet), installable on iOS/Android.
- Reduced-motion global handling; `prefers-reduced-motion` disables the (future) shuffle animation.

### 9. Test harnesses
- Vitest: unit config + integration config (integration boots against local Supabase, truncates
  between tests).
- **RLS harness** `pnpm test:rls`: helper creating users A and B with real JWTs, then a reusable
  `expectRlsIsolation(table, rowFactory)` assertion covering select/insert/update/delete and anon
  access. Prove it on `smoke_notes`.
- Playwright: config for mobile (390px) + desktop projects, `@axe-core/playwright` wired, one smoke
  spec (`/` renders, health OK, nav present, zero serious axe violations).
- `pnpm eval` scaffold that exits 0 with "no evals registered".
- `src/__tests__/invariants/` directory created with the file list from
  [../TESTING.md](../TESTING.md#principles); each file present as a skipped placeholder naming the
  phase that implements it. **This makes the invariant list impossible to forget.**

### 10. CI
- GitHub Actions: `lint → typecheck → unit+integration (with Supabase service) → rls → build → e2e`.
- CI checks specified in [../TESTING.md](../TESTING.md#ci-gates): prompt/schema version-bump check,
  deletion-registry completeness (registry file created empty this phase), client-bundle key scan.

### 11. Demo data scaffold
- `scripts/seed-demo.ts` with a documented extension point per object type and a `--months` flag.
  Prints "nothing to seed yet" this phase. **Every later phase extends it.**

## Test plan

Run and paste output into the report:
```
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm test:e2e
```
Specific assertions that must exist:
- [ ] `run.ts` policy: invalid JSON → one repair → success; second failure → soft fail; timeout →
      retry → tier downgrade → soft fail; 429 → backoff → circuit breaker opens after 5.
- [ ] `expectRlsIsolation('smoke_notes')` passes; B cannot read/write/delete A's row; anon reads nothing.
- [ ] Logger type rejects content-bearing props (type-level test via `expect-type` or `tsd`).
- [ ] Sentry scrubber removes a `user_notes` field from a captured event.
- [ ] Job handler: success, retry after failure, `dead` after `max_attempts`.
- [ ] Registry: every `TaskId` → tier → model ID.
- [ ] Layering lint fails on a deliberate `domain → db` import (verify manually, then revert).
- [ ] `/api/health` returns 200 with DB + migration status.
- [ ] axe: zero serious/critical on `/` and `/dev/ui`.

Manual verification:
- [ ] Fresh-machine path works: clone → `pnpm i` → `pnpm supabase:start` → `pnpm db:migrate` →
      `pnpm dev` → app loads. Follow your own README literally and fix whatever is missing.
- [ ] App installs as a PWA on a phone (or emulated) and the shell renders offline.
- [ ] `/dev/ui` looks intentional in both themes at 390px — not default shadcn. If it looks generic,
      fix the tokens now; it gets harder later.

## Exit criteria

- [ ] All commands above pass from a clean clone.
- [ ] Architecture directories exist with the layering rule enforced and proven.
- [ ] `src/ai/run.ts` failure policy fully tested against the mock provider.
- [ ] RLS harness proven; invariant placeholders committed.
- [ ] Design tokens, base components and `/dev/ui` in place, both themes, a11y clean.
- [ ] README documents setup, commands and the phase workflow.
- [ ] Report written to `completed/phase-00-report.md`; `../PROGRESS.md` updated.
