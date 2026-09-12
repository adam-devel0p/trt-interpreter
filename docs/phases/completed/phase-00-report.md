# Phase 00 — Completion Report

**Status:** complete-with-deferrals
**Date:** 2026-09-12
**Phase file:** [../phase-00-foundations.md](../phase-00-foundations.md)

---

## 1. What was built

The repository went from docs-only to a bootable Next.js 15 / React 19 / TypeScript-strict app with a
local Supabase stack, Drizzle migrations, and every test rail later phases need. There are no product
features on purpose. What exists: Zod-validated env split into client/server modules; a content-free
structured logger whose prop type rejects journal fields at compile time; a Sentry scrubber with a
test; the `jobs` table plus a claim-and-run worker (`FOR UPDATE SKIP LOCKED`, exponential backoff,
dead-letter) exposed at `POST /api/jobs/run` and `pnpm jobs:run`; the AI boundary (`provider.ts`,
`registry.ts`, `run.ts`, `telemetry.ts`, `providers/mock.ts`) with the full retry/repair/timeout/
downgrade/backoff/circuit-breaker policy implemented and tested branch-by-branch against the mock;
feature flags with env defaults, a tolerant `user_flags` read path and a `/dev/flags` page; the
design-token system (paper/ink, RWS gold / Thoth violet accents, light + dark) with nine base
components and a `/dev/ui` gallery; PWA manifest, icons and an offline-shell service worker; three
Vitest configs (unit / integration / RLS), a reusable RLS harness proven on a throwaway table,
Playwright with axe at 390px and desktop; twelve skipped invariant placeholders; GitHub Actions CI;
and the seed/eval/CI-check script scaffolds. Architecture layering is enforced by ESLint rules that
were shown to fire on deliberate violations.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| Local Supabase on ports **55321–55329** (not the 54xxx defaults) | Another project on this machine already owns 54321/54322; `.env.example` and README point at the new ports so the fresh-machine path works. | Stopping the other project's containers (not mine to stop). |
| Env split into `src/config/env.ts` (client-safe) and `src/config/env.server.ts` (server-only) | The phase asked for separate objects; two modules make the lint rule trivial (`'use client'` file importing `env.server` → error) and `server-only` makes it a build error too. | One module with two exports (client import would still bundle the server parser). |
| `server-only` modules are run by scripts with `tsx --conditions=react-server`; Vitest aliases `server-only` to an empty stub | The `server-only` package throws outside React Server environments. The condition flag selects its empty build without disabling the Next.js protection. | Dropping `server-only` (loses the build-time guarantee). |
| Drizzle migrations live in `src/db/migrations` with a custom `0000_extensions.sql` before the generated `0001_platform.sql` | Extensions can't be expressed in the Drizzle schema; a custom migration keeps everything in one journal. `pg_cron` is created in a `DO` block that logs a NOTICE on failure. | `supabase/migrations` (two migration systems). |
| RLS policies are written in the Drizzle schema (`pgPolicy` + `authUid`), so `drizzle-kit generate` emits them | Policies stay next to the table definition and can't be forgotten in a hand-written migration. Drizzle emits `(select auth.uid())`, the Supabase-recommended form. | Hand-appending SQL after each generate. |
| `jobs` has RLS enabled with **no policies** | Service-role only. Verified by `jobs.rls.test.ts`: authenticated users can't see or insert even their own jobs. | Per-user select policy (nothing needs it yet). |
| `run.ts` returns `RunResult` and never throws for model problems; refusal is a `RunStatus` | Callers get a discriminated union and can't forget the failure branches. `refusal` was added to the `ai_calls.status` list in DATA_MODEL.md. | Throwing typed errors (easy to leave uncaught in a route handler). |
| Telemetry records one row per **run** (with `attempts`), not per provider attempt | Simpler cost accounting; attempt counts are on the row. Phase 04 can switch to per-attempt rows if cost dashboards need it. | Per-attempt rows. |
| Timeout policy detail: 1st timeout → same tier, 2nd → downgrade, 3rd → fail; at `fast` retry-once-then-fail | Matches the phase's required assertion ("timeout → retry → tier downgrade → soft fail") in three calls. Documented in AI_LAYER.md. | Retrying again after the downgrade. |
| Layering enforced with `no-restricted-imports` per layer plus two local rules, using **gitignore-style anchored patterns** (`/ai`, `/openai`) | `no-restricted-imports` options do not merge across flat-config blocks and unanchored `ai` matched `@/ai`; each layer now gets one composed pattern set. Proven by probes (see §8). | `eslint-plugin-boundaries` (another dependency for the same result). |
| Colour literals allowed in exactly one file, `src/ui/theme-colors.ts` | `<meta theme-color>` and the manifest can't read CSS variables. The lint rule exempts only that file, which must mirror `--bg`. | Disabling the rule inline. |
| Playwright "mobile" project is **Chromium with Pixel-7 emulation at 390×844**, not iPhone/WebKit | One browser to install locally and in CI; 390px is what DESIGN_SYSTEM.md specifies. | WebKit device (extra 400 MB install, no additional signal yet). |
| Dark-mode axe audit runs on a **fresh document via `prefers-color-scheme` emulation** | axe caches computed styles per injection; auditing after an in-page theme toggle intermittently read light colours on the dark ground (1 in ~4 runs). Fresh navigation is deterministic and also exercises the media-query token path. | `waitForTimeout` after toggling (still flaky). |
| Fonts via `@fontsource-variable/newsreader` (content serif) + `@fontsource-variable/dm-sans` (UI sans), self-hosted through the bundle | Self-hosted, `font-display: swap`, real fallback stacks in tokens.css. | `next/font/google` (fetches from Google at build). |
| `--fg-faint` raised to AA (light `#6f675d` 4.9:1, dark `#948b7e` 5.6:1) | The first value (3.3:1) was a real axe failure on the landing footer. Faint text still fails on `surface-2`; use `fg-muted` there. | Keeping it decorative-only (it will be used for text). |
| `pnpm` settings live in `pnpm-workspace.yaml` (`allowBuilds`) | pnpm 11 no longer reads `package.json#pnpm`. `@sentry/cli` build is explicitly denied (binary download for source maps we don't use). | — |

## 3. Files and modules

```
Config / tooling
  package.json, pnpm-workspace.yaml, tsconfig.json (strict + noUncheckedIndexedAccess), next.config.ts
  eslint.config.mjs ★  eslint/local-rules.mjs ★     layering + server-env + no-hardcoded-colours rules
  .prettierrc, .env.example ★, drizzle.config.ts, vercel.json (cron), postcss.config.mjs
  vitest.config.ts / vitest.integration.config.ts / vitest.rls.config.ts / vitest.shared.ts
  playwright.config.ts, .github/workflows/ci.yml ★, README.md ★
  instrumentation.ts, instrumentation-client.ts, sentry.server.config.ts, sentry.edge.config.ts

src/config/
  env.ts ★            client-safe Zod env (NEXT_PUBLIC_*), lazy, loud failure
  env.server.ts ★     server-only Zod env: DB, keys, AI routing, FLAG_* defaults

src/observability/
  logger.ts ★         content-free logger; Exact<LogProps> type; runtime whitelist; errorClassOf()
  scrub.ts ★          Sentry beforeSend scrubber (bodies, cookies, auth headers, content fields)

src/db/
  schema/enums.ts     all 11 enums from DATA_MODEL.md
  schema/jobs.ts ★    jobs table (RLS on, no policies)
  schema/smoke.ts     THROWAWAY smoke_notes (4 RLS policies) — Phase 01 drops
  migrations/0000_extensions.sql, 0001_platform.sql, meta/
  client.ts ★         RLS-respecting Supabase clients (browser, server-with-cookies, token, anon)
  admin/client.ts     service-role postgres-js + drizzle + supabase (lint-guarded)
  admin/index.ts ★    narrow surface: pingDatabase, latestAppliedMigration, platformDb, platformSql, authAdmin, truncateTables

src/ai/
  types.ts ★          TASK_IDS (13), MODEL_TIERS, request/result/chunk types, error classes
  provider.ts ★       AiProvider interface, AiProviderError
  registry.ts ★       TASK_TIERS, TIER_TIMEOUT_MS, routingFromEnv, downgradeTier, validateRouting
  run.ts ★            createAiRunner: runObject / runStream with the full failure policy
  circuitBreaker.ts   per-provider breaker (threshold 5, cooldown 60s, half-open)
  telemetry.ts        AiCallRecord, AiTelemetrySink (MemoryTelemetry / noop), BudgetPolicy hook
  providers/mock.ts ★ deterministic fixtures + failWith('timeout'|'invalid_json'|'refusal'|'429'|'500')
  index.ts            getAiRunner() (mock only), describeProviderConfig() for /api/health

src/jobs/
  types.ts            JobHandler / JobContext / defineJob
  handlers/noop-echo.ts, handlers/index.ts (registry)
  enqueue.ts ★        validates payload against the handler schema, inserts
  worker.ts ★         runBatch(): claim (skip locked, stale-lock reclaim) → run → succeeded / retry / dead

src/flags/
  flags.ts            FLAGS list, envKeyFor
  resolve.ts          pure resolution (env → user → dev session), dev cookie parsing
  index.ts ★          flag(), allFlags() (server-only; tolerates missing user_flags)

src/domain/privacy/
  deletionRegistry.ts ★  root → cascade targets (jobs, smoke_notes under `user`)
  registryCheck.ts        structural check over a Drizzle schema module (no db/ import)

src/ui/
  tokens.css ★        full light palette on :root, dark under media query + [data-theme], [data-deck] accents
  theme-colors.ts     the one sanctioned colour-literal file (manifest / theme-color)
  motion.tsx          MotionProvider (framer reducedMotion="user")
  lib/cn.ts
  components/         app-shell, bottom-nav (5 tabs), page-header, button, skeleton, empty-state,
                      error-state, confirm-destructive (Radix AlertDialog), inferred-chip (Radix Popover),
                      confidence-badge (qualitative bands only), sw-registration, index.ts

app/
  layout.tsx ★        fonts, globals.css, MotionProvider, SW registration, metadata/viewport
  globals.css ★       Tailwind v4 @theme mapping tokens → utilities; base + reduced-motion
  (marketing)/page.tsx           landing with <nav aria-label="Primary">
  (auth)/sign-in/page.tsx        placeholder
  (app)/layout.tsx + home/ journal/ journey/ ask/ profile/   AppShell + BottomNav, EmptyState stubs
  api/health/route.ts ★          DB + migration + provider status, no model call
  api/jobs/run/route.ts ★        bearer-secret protected batch runner (GET + POST)
  dev/layout.tsx, dev/ui/page.tsx + gallery.tsx ★, dev/flags/page.tsx (server action → cookie)
  manifest.ts, offline/page.tsx, not-found.tsx
public/ sw.js (offline shell), icon.svg, icons/*.png

scripts/
  _env.ts, db-migrate.ts, jobs-run.ts, eval.ts, seed-reference.ts, seed-demo.ts ★ (SEEDERS extension point),
  check-prompt-versions.ts, check-client-bundle.ts, check-deletion-registry.ts, gen-icons.ts

Tests
  src/ai/__tests__/run.test.ts ★, registry.test.ts, circuitBreaker.test.ts
  src/observability/__tests__/logger.test.ts, logger.test-d.ts ★ (type-level), scrub.test.ts
  src/flags/__tests__/resolve.test.ts, src/config/__tests__/env.test.ts
  src/db/__tests__/deletion-registry.test.ts, smoke-notes.rls.test.ts ★, jobs.rls.test.ts
  src/jobs/__tests__/worker.integration.test.ts ★
  src/__tests__/rls/harness.ts ★, src/__tests__/integration/setup.ts, src/__tests__/stubs/server-only.ts
  src/__tests__/invariants/*.test.ts (12 skipped placeholders)
  e2e/smoke.spec.ts ★
fixtures/decks, fixtures/history, fixtures/ai   (empty directories for later phases)
```

## 4. Database changes

- `0000_extensions.sql`: `pgcrypto`, `pg_trgm`, `vector` in schema `extensions`; `pg_cron` inside a
  `DO` block (NOTICE on failure). All four installed locally (`pg_cron 1.6.4`, `vector 0.8.2`).
- `0001_platform.sql`: all 11 enums from DATA_MODEL.md; `jobs` (12 columns, indexes
  `jobs_claim_idx (status, run_after)` and `jobs_user_idx`, FK to `auth.users` on delete cascade,
  RLS enabled, no policies); `smoke_notes` (RLS enabled, four `authenticated` policies keyed on
  `(select auth.uid())`); table comments.
- DATA_MODEL.md updated: `jobs.updated_at`, `jobs` RLS note, `smoke_notes` entry, `ai_calls.status`
  gains `'refusal'`.
- Migration state is checked by `/api/health` against `src/db/migrations/meta/_journal.json`.

## 5. AI tasks touched

None implemented. `TaskId` covers all 13 catalogue tasks; `registry.test.ts` asserts each resolves to a
tier and a model ID. Mock fixtures are keyed by `task` + `fixture` name; the only fixture in tests is
`classify_safety/default`.

## 6. Thresholds and constants

| Constant | Where | Value |
|---|---|---|
| `TIER_TIMEOUT_MS` | `src/ai/registry.ts` | fast 15 000 · standard 45 000 · deep 45 000 |
| `RETRY_POLICY` | `src/ai/run.ts` | maxRateLimitAttempts 3 · backoffBase 500ms · backoffMax 8 000ms · breakerThreshold 5 · breakerCooldown 60 000ms |
| `WORKER_POLICY` | `src/jobs/worker.ts` | defaultBatch 25 · staleLock 10 min · backoffBase 1s · backoffMax 1h |
| `ConfidenceBadge` bands | `src/ui/components/confidence-badge.tsx` | high ≥ 0.85 · medium ≥ 0.60 · low (mirrors ALGORITHMS.md link bands) |

No `thresholds.ts` exists yet; ALGORITHMS.md unchanged.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `ai/__tests__/run.test.ts` (15) | invalid JSON → one repair → success; second failure → soft fail; schema mismatch counts as invalid; timeout → retry → downgrade → soft fail (tiers `deep,deep,standard` observed); downgraded attempt can succeed; fast tier retry-once; 429 → backoff `[750, 1500]` → success; 3×5xx → provider_error; breaker opens after 5 consecutive failures and short-circuits with zero provider calls; success resets breaker; refusal terminal; budget denial before any call; stream happy path + refusal |
| unit | `ai/__tests__/registry.test.ts`, `circuitBreaker.test.ts` | every TaskId → tier → model; missing model fails loudly; downgrade chain; breaker open/half-open/reset |
| unit (type) | `observability/__tests__/logger.test-d.ts` | `@ts-expect-error` on `user_notes`, `question`, `body`, `description` (via variable), free-form event names |
| unit | `observability/__tests__/logger.test.ts`, `scrub.test.ts` | runtime whitelist drops smuggled keys, string cap, event-name guard; scrubber redacts `user_notes` in extra/contexts/breadcrumbs, drops request body/cookies/auth headers, keeps only `user.id`, redacts serialised fields in messages |
| unit | `flags/__tests__/resolve.test.ts`, `config/__tests__/env.test.ts`, `db/__tests__/deletion-registry.test.ts` | resolution order; env errors name variables not values; registry covers every `user_id` table and detects an unregistered one |
| integration | `jobs/__tests__/worker.integration.test.ts` (6) | success; retry with backoff then success (attempts 2); dead after max_attempts and never reclaimed; unknown kind → dead, bad payload rejected at enqueue; batch limit; backoff curve |
| rls | `db/__tests__/smoke-notes.rls.test.ts`, `jobs.rls.test.ts` | B cannot read/insert-as-A/update/delete A's row, anon reads nothing, A can delete own; `jobs` invisible and unwritable to users and anon |
| e2e | `e2e/smoke.spec.ts` (6 × 2 projects) | `/` heading + primary nav + axe; `/api/health` 200 with db/migration/provider; `/home` 5 tabs, aria-current, skip link focus; `/dev/ui` axe light + dark, theme/deck attributes, AlertDialog keyboard; manifest/sw/offline served; `/api/jobs/run` 401 |

Invariant tests unskipped this phase: none (all 12 placeholders created, each naming its phase).

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
$ eslint . && prettier --check . && tsx scripts/check-deletion-registry.ts
Checking formatting...
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 RUN  v5.0.0 /Users/mario/dev/trt-interpreter
 Test Files  9 passed | 12 skipped (21)
      Tests  44 passed | 12 skipped (56)
Type Errors  no errors
 RUN  v5.0.0 /Users/mario/dev/trt-interpreter
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ pnpm test:rls
 Test Files  2 passed (2)
      Tests  2 passed (2)

$ pnpm build
   ▲ Next.js 15.5.25
 ✓ Compiled successfully in 3.0s
 ✓ Generating static pages (13/13)
+ First Load JS shared by all             103 kB
$ pnpm check:client-bundle
check-client-bundle: ok (34 files scanned)

$ pnpm test:e2e            (six consecutive runs after the dark-mode audit fix)
  12 passed (4.6s) · 12 passed (3.9s) · 12 passed (4.3s) · 12 passed (4.1s) · 12 passed (4.3s) · 12 passed (4.1s)
```

Layering lint proven on deliberate violations (then reverted):
```
src/domain/_probe/bad.ts     '@/db/schema' … domain/ may not import db/
                             '@/ai/run'    … domain/ may not import ai/
                             'next/headers'… domain/ is framework-free
src/jobs/_bad-sdk.ts         '@anthropic-ai/sdk' … only inside src/ai/
                             '@/db/admin/client' … import the narrow surface from @/db/admin
                             'postgres'          … direct database connections only in src/db/admin/
src/ai/_bad.ts               '@/db/admin' … ai/ touches the database only through telemetry.ts
src/ui/components/_bad-client.tsx  '@/config/env.server' is server-only … from a 'use client' module
                             Hard-coded colour "bg-red-500"
✖ 11 problems across the probes; `pnpm eslint .` clean after revert
```

RLS harness proven to detect a broken policy: with `alter table smoke_notes disable row level
security` the suite fails with `B must not read A's smoke_notes row: expected [] to have length 0 but
got 1`; re-enabled, it passes.

Health endpoint (dev server, README path):
```
{"status":"ok","db":true,"migration":{"current":true,"expected":"0001_platform","appliedAt":1789216860783},
 "provider":{"provider":"mock","configured":true,"routing":true},"durationMs":2}
```

| Metric | Target | Measured |
|---|---|---|
| Unit suite | fast | 2.1 s (59 % of it is the type-level check) |
| Integration suite | — | 0.6 s |
| RLS suite | — | 1.7 s (2 users created per file) |
| E2E (12 tests, 2 projects) | — | ~4.2 s after `next start` |
| First Load JS shared | small | 103 kB; `/dev/ui` 144 kB |

Manual checks actually performed:
- [x] Fresh-machine path: followed README — `pnpm install` → `supabase:start` → copy keys → `db:migrate`
      → `pnpm dev` → `/`, `/home`, `/dev/flags`, `/manifest.webmanifest` all 200; `/api/jobs/run` with
      the bearer secret returns a batch result; without it 401. Port conflict with another project was
      the only thing that broke, fixed by moving to 55xxx and documenting it.
- [x] `/dev/ui` at 390px, light and dark, RWS and Thoth (screenshots reviewed): paper/ink ground,
      serif content vs sans chrome, AI text in its tinted left-edged container, accent swap gold→violet.
      It reads as a journal, not default shadcn.
- [x] Keyboard: skip link is the first Tab stop on `/home`; AlertDialog opens from a button, traps
      focus, closes on Escape (asserted in e2e). Popover "why?" has an accessible name.
- [x] Reduced motion: e2e emulates it; global CSS collapses transitions; `MotionConfig reducedMotion="user"`.
- [~] PWA installability: manifest (`display: standalone`, maskable icon), `apple-touch-icon`,
      `sw.js` (network-first pages, offline fallback, cache-first static) are served and register in
      production. **Not installed on a physical phone** — see Deferred.

## 9. UX notes

Four states exist as components: `Skeleton`/`SkeletonCard`, `EmptyState` (teaches the next action),
`ErrorState` (title → what is safe → retry, in that order), and streaming is not yet needed. The
user-vs-AI text contract from DESIGN_SYSTEM.md is demonstrated in the gallery (serif on plain paper vs
sans in `surface-ai` with a hairline-strong left edge). `InferredChip` always shows the word
"suggested", has one-tap correct/dismiss and a "why?" popover listing reasons. `ConfidenceBadge`
renders three qualitative bands with dots + label, never a number (invariant 13).

Rough edges left deliberately: the landing page is a placeholder; `/sign-in` is a stub; the bottom nav
preview in the gallery is a static clip; `Button` hover uses opacity rather than a dedicated
hover token (fine until a hover audit).

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Install as PWA on a physical iOS/Android device and verify offline shell | No device in this session; manifest/SW/icons verified by e2e only | Phase 01 manual checks (first phase with a real screen to install) |
| `ai_calls` write in `telemetry.ts` | Table lands in Phase 04 per plan; `AiTelemetrySink` interface + `MemoryTelemetry` stand in | Phase 04 |
| Real budget enforcement (`BudgetPolicy`) | `usage_counters` lands in Phase 11; hook is wired and tested with a denying policy | Phase 11 |
| Sentry source-map upload (`withSentryConfig`, `@sentry/cli`) | Not needed to prove scrubbing; avoids a build-time binary download | Phase 12 |
| Rate limiting on API routes | Only `/api/jobs/run` exists (secret-protected) | Phase 01 (auth endpoints) |

## 11. Known issues and risks

- axe caches computed styles per injection; never audit after an in-page theme toggle — navigate.
  Documented in the e2e spec.
- Drizzle `db.execute(sql\`…\`)` does not serialise `Date` params for postgres-js; pass ISO strings
  (`::timestamptz`). Bit me once in the worker.
- `pg_cron` is installed locally but nothing schedules through it; production job cadence is Vercel
  cron (`* * * * *`). If Vercel's plan limits cron frequency, `/api/jobs/run` still drains a bounded
  batch per call.
- The dev server and `pnpm build` share `.next`; running `next dev` invalidates a production build
  (Playwright then fails to start `next start` until you rebuild).
- `.env.local` on this machine contains the local Supabase keys (gitignored). CI derives its own from
  `supabase status`.
- Supabase CLI now issues `sb_publishable_…`/`sb_secret_…` keys alongside the legacy JWTs; both key
  styles are accepted by supabase-js, and the bundle scan checks for both.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status   # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Open `http://localhost:3000/api/health` → `status: ok`.
2. Open `/dev/ui` at 390px; toggle light/dark and RWS/Thoth; open "Delete this reading" and press Escape.
3. Open `/dev/flags`; set a flag "on"; the resolved value flips for this browser only.
4. `curl -X POST -H "Authorization: Bearer $JOBS_RUN_SECRET" localhost:3000/api/jobs/run` → batch counts.

## 13. Notes for the next phase

- The RLS harness (`src/__tests__/rls/harness.ts`) assumes an owner column named `user_id`;
  `profiles` is keyed by `id` — add an `ownerColumn` option. (Written into the Phase 01 file.)
- Removing `smoke_notes` touches five places; the exact list is now in the Phase 01 file.
- `check-deletion-registry` runs inside `pnpm lint`: any new table with a `user_id` column fails lint
  until it is registered in `src/domain/privacy/deletionRegistry.ts`.
- Scripts that import `server-only` modules need `tsx --conditions=react-server` (see `jobs:run`).
- `demo:seed` has the `SEEDERS` array ready; Phase 01 adds the first entry (users + profiles).
- `createServerUserClient(cookies)` in `src/db/client.ts` takes a cookie adapter so it stays
  `next`-free; Phase 01 wraps it with `next/headers` `cookies()` in a small `src/db/session.ts`.
