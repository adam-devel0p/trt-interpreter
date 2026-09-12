# Phase 01 — Completion Report

**Status:** complete-with-deferrals
**Date:** 2026-09-12
**Phase file:** [../phase-01-auth-onboarding.md](../phase-01-auth-onboarding.md)

---

## 1. What was built

A person can now create an account (email + password, magic link, or Google), be walked through a
four-step onboarding (Welcome → usage style → experience → privacy & AI consent) and land on a real
Home shell via the Phase 03 reading stub, with their preferences stored in `profiles`. Declining AI
consent is a first-class path: the app works identically, Profile says AI is off, and consent can be
granted or withdrawn there later. Sessions live in httpOnly cookies managed by `@supabase/ssr`; a
root `middleware.ts` refreshes them and enforces route protection from a pure, table-driven route
policy (`src/auth/routes.ts`). Auth use-cases live in `src/auth/service.ts` with injected
dependencies (Supabase client, rate limiter, logger) so they are integration-tested without Next;
`src/auth/actions.ts` is the thin `'use server'` glue. The database gained `profiles`
(trigger-created on `auth.users` insert, `plan` protected by trigger), `user_flags` (read-own,
service-role writes) and `reminder_settings`, all with RLS proven by the extended harness;
`smoke_notes` is gone. The Profile screen has real controls for consent and explanation depth and
labelled placeholders (with the phase that brings them) for everything else. Two demo users are
seeded by `pnpm demo:seed`.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| Onboarding = **4 action steps** (`welcome`, `usage_style`, `experience`, `consent`) then straight to `/reading/new` | Reconciles the phase file's "five screens" with "four-step onboarding" and the e2e "sign up → 4 steps → Home": the fifth screen is the reading itself. Progress is `profiles.onboarding_step` (index), so a drop-off resumes at the exact step. | A public `/welcome` before sign-up (extra hop, nothing to persist). The value sentence sits above every auth screen instead, so there is still no wall before it. |
| Step events are carried by the **submit button's `name`** (`continue`, `skip`, `back`, `choose_usage_style=…`) | A step form has several buttons; a shared hidden `event` field shadowed the submitter's value (FormData returns the first) and made Back/Skip no-ops. Found by e2e. | Hidden `event` input + `value` buttons. |
| **Google** is the one OAuth provider | Simplest local setup; Apple is a config addition later per the phase file. Enabled in `supabase/config.toml` via `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET)`; without them the button degrades to a neutral message. | Apple (needs a paid developer account and key files to test at all). |
| `profiles.plan` is protected by a **`BEFORE UPDATE` trigger** raising `42501` when `auth.role() = 'authenticated'` | RLS cannot compare old vs new rows. Column-level `GRANT UPDATE (cols…)` would silently make every future column non-updatable until someone remembers to grant it. | Column-level privileges. |
| `user_flags` is **select-own only**; writes are service-role | A rollout flag must not be flippable by the person it gates (cost exposure for unreleased AI paths). `set_by='user'` stays in the enum for a later opt-in surface. The phase file said "reuse `expectRlsIsolation`"; `expectReadOwnOnly()` was added instead. | Standard four policies. |
| No delete policy on `profiles` | Account deletion is a service-role job (Phase 12) that cascades from `auth.users`; a user deleting their profile row would leave an account with no profile. Harness asserts the owner *cannot* delete. | Four-policy set. |
| **Per-IP rate limits skip loopback**; per-email limits always apply | The in-memory limiter is per server process. Repeated local e2e runs against one `next start` (always `127.0.0.1`) exhausted the sign-up bucket and failed unrelated specs. Production traffic always carries `x-forwarded-for`, so loopback never means a real client. IP limiting is still proven by the integration test with a non-loopback IP. | Raising limits (still tripped after a few runs); an env kill-switch (dangerous). |
| Rate limiter is **in-memory, per instance** | Honest and adequate behind Supabase Auth's own limits; a shared store is Phase 12 hardening. `RateLimitStore` is an interface so swapping is local. | Postgres/Upstash store now. |
| `settle()` echoes the typed **email back into form state** | React 19 resets uncontrolled form fields after an action, so a failed sign-in wiped the email. Found by e2e (the password-reset spec re-typed only the password). | Controlled inputs (more client state for no gain). |
| Redirect origins come from **request headers**, not `request.url` | In `next start`, `request.url` reports `localhost` while the browser is on `127.0.0.1` — a different cookie origin, so the just-set session was dropped after the auth callback. `requestOrigin()` is shared by actions and the callback route. | `request.nextUrl.origin`. |
| Middleware runs `getUser()` **only** on protected and auth paths | Marketing/offline/API pages pay no auth round-trip; `decideRoute()` is pure and unit-tested over every prefix. Malformed cookies resolve to "signed out", never a 500. | Running on every path. |
| `reminder_settings` created now (DATA_MODEL said Phase 11) | The phase file's task list asks for it; the Profile placeholder has a home and the RLS test exists before any UI. | Waiting for Phase 11. |
| Inline links are always **underlined** | axe `link-in-text-block`: accent-on-muted contrast is 1.1:1, so colour alone cannot distinguish links. `Button variant="link"` changed too. | Hover-only underline. |
| `expectNoSeriousA11y()` waits for a non-empty `<title>` | After a soft navigation Next applies `<title>` a tick later than the body; axe intermittently reported `document-title` on `/home`, which does have a title. | Sleeping. |
| Local `[auth.rate_limit] email_sent = 200`, `minimum_password_length = 8` | E2E sends real mail through Mailpit (the default 2/hour would break the second run); the app's Zod rule is 8 characters, so the server agrees. Hosted projects take these from the dashboard. | — |

## 3. Files and modules

```
middleware.ts ★                   session refresh + route protection; only runs on protected/auth paths

src/auth/
  routes.ts ★                     PROTECTED_PREFIXES, AUTH_ROUTES, decideRoute(), safeReturnPath() — pure
  service.ts ★                    signIn/signUp/magicLink/reset/updatePassword/startOAuth/signOut with injected deps
  actions.ts ★                    'use server' glue: headers → context → service → redirect / form state
  profile-actions.ts              consent toggle + explanation depth writes (revalidatePath('/profile'))
  session.ts ★                    getSessionClient(), getUser() (react cache), requireUser()
  limiter.ts                      process-wide RateLimiter; clientIp() (null for loopback)
  origin.ts                       requestOrigin(headers) — proxy-aware origin for redirects
  copy.ts                         generic auth copy (never reveals account existence)
  form-state.ts                   AuthFormState / PrefState (constants cannot live in 'use server' files)
  __tests__/routes.test.ts, service.integration.test.ts, profile.integration.test.ts

src/domain/
  onboarding/machine.ts ★         ONBOARDING_STEPS, transition(), resumeStep() — pure, fully tested
  auth/rateLimit.ts ★             sliding-window limiter over a RateLimitStore; AUTH_RATE_RULES

src/db/
  schema/profiles.ts ★            profiles, user_flags, reminder_settings + pgPolicy sets
  schema/enums.ts                 + usage_style, experience_level, explanation_depth, flag_set_by, reminder_channel
  migrations/0002_auth_profiles.sql ★  generated DDL + hand-written triggers (see §4)
  queries/profile.ts ★            getProfile / updateProfile (Zod, strict) / setAiConsent / hasAiConsent
  session.ts                      createSessionClient(): next/headers cookies → createServerUserClient
  __tests__/profiles.rls.test.ts ★, user-flags.rls.test.ts, reminder-settings.rls.test.ts

src/__tests__/rls/harness.ts ★    + ownerColumn, preexisting; + expectReadOwnOnly()
src/flags/__tests__/user-override.integration.test.ts   user_flags overrides resolve through flag()

src/ui/components/
  field.tsx                       Field (label/input/error wired for AT), FormMessage (alert/status)
  choice-button.tsx               one-tap submit option for onboarding steps
  focus-heading.tsx               'use client' h1 that takes focus on mount (keyed by step)
  switch.tsx                      Radix Switch on tokens
  settings.tsx                    SettingsSection / SettingsRow (comingIn="Phase NN" placeholders)

app/
  (auth)/layout.tsx               narrow column, value sentence above every auth screen
  (auth)/_components/auth-forms.tsx ★  SignIn (password | magic link), SignUp, Forgot, Reset, Google button
  (auth)/sign-in|sign-up|forgot-password|reset-password/page.tsx
  auth/callback/route.ts ★        code exchange / token_hash verify → next; failures → /sign-in?link=expired
  (onboarding)/layout.tsx, onboarding/page.tsx, steps.tsx ★, actions.ts ★
  (app)/layout.tsx ★              requireUser + onboarding gate (redirects to /onboarding until complete)
  (app)/home/page.tsx             Start a reading · "Still open" slot · "Worth a look" slot (empty states)
  (app)/profile/page.tsx ★, profile/controls.tsx (ConsentToggle, DepthSelect)
  (app)/reading/new/page.tsx      Phase 03 stub; onboarding hands off here
  (marketing)/privacy/page.tsx    the readable policy the consent step links to
  dev/ui/gallery.tsx              + Field/FormMessage, ChoiceButton, Settings/Switch sections

e2e/
  _helpers.ts ★                   axe (waits for title), tabTo() keyboard nav, signUpViaUi, createReadyUser, latestEmailLink (Mailpit)
  auth-security.spec.ts ★         table-driven route protection, malformed cookie, axe on every auth screen, generic errors, Google
  onboarding.spec.ts ★            keyboard-only sign up → 4 steps → Home; decline path; consent/depth from Profile
  auth-email.spec.ts ★            password reset and magic link through real Mailpit mail; expired link

scripts/seed-demo.ts              seedUsers (idempotent): demo-ana (AI on) / demo-ben (AI off)
supabase/config.toml              password ≥ 8, email_sent 200 (local), Google provider via env, callback redirect URLs
.env.example, README.md           Google env vars, demo credentials, Mailpit
```

## 4. Database changes

`0002_auth_profiles.sql` (generated by `drizzle-kit generate --name auth_profiles`, then
hand-extended after a `-- Hand-written` marker):

- Enums `usage_style`, `experience_level`, `explanation_depth`, `flag_set_by`, `reminder_channel`.
- `profiles` (14 columns, PK = FK `auth.users(id)` on delete cascade), policies `profiles_select /
  _insert / _update` on `id = (select auth.uid())`. No delete policy.
- `user_flags` (unique `(user_id, flag)`), policy `user_flags_select` only.
- `reminder_settings` (unique `user_id`), the four standard policies.
- `DROP TABLE smoke_notes` (+ its four policies).
- Functions/triggers: `public.set_updated_at()` (attached to all three tables),
  `public.handle_new_auth_user()` (security definer, `search_path = ''`) with trigger
  `on_auth_user_created AFTER INSERT ON auth.users`, backfill `INSERT … SELECT id FROM auth.users`,
  `public.profiles_protect_plan()` with trigger `profiles_protect_plan BEFORE UPDATE`.
- Table comments on all three.

DATA_MODEL.md updated: new enums, `onboarding_step`/`updated_at` columns, trigger creation, the
`plan` rule, `user_flags` write policy, `reminder_settings` timing, RLS variants paragraph,
`smoke_notes` marked dropped. `default_deck_id` has **no FK yet** — Phase 02 adds it.

## 5. AI tasks touched

None. No model call exists in this phase. `ai_consent_at` is the gate later phases must check
before any call on a user's behalf (`hasAiConsent(profile)` in `src/db/queries/profile.ts`).

## 6. Thresholds and constants

| Constant | Where | Value |
|---|---|---|
| `AUTH_RATE_RULES.signInIp` | `src/domain/auth/rateLimit.ts` | 40 / 15 min |
| `AUTH_RATE_RULES.signInEmail` | same | 8 / 15 min (reset on successful sign-in) |
| `AUTH_RATE_RULES.signUpIp` | same | 30 / 60 min |
| `AUTH_RATE_RULES.emailLinkIp` / `emailLinkEmail` | same | 30 / 15 min · 4 / 15 min |
| `AUTH_RATE_RULES.passwordUpdate` | same | 6 / 15 min per IP |
| Password length | Zod in `service.ts` + `config.toml` | 8–128 |

No `thresholds.ts`; ALGORITHMS.md unchanged.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/onboarding/__tests__/machine.test.ts` (8) | exact §6.1 step order; happy path completes with consent timestamp; decline completes with null; only usage/experience skippable; back never before first; stale events rejected; resume by stored step, out-of-range clamps; every step reaches done in ≤ 4 actions |
| unit | `domain/auth/__tests__/rateLimit.test.ts` (4) | allows to limit then trips with retry-after; denied hits don't extend the window; sliding; independent keys; reset |
| unit | `auth/__tests__/routes.test.ts` (table-driven over `PROTECTED_PREFIXES` × auth state, `AUTH_ROUTES`) | every protected prefix redirects unauthenticated with return-to (none for `/home`); auth routes bounce signed-in users to a *safe* next; public and `/reset-password` untouched; `safeReturnPath` rejects `//`, `https://`, `/\`, CRLF, bare words |
| unit | `db/__tests__/deletion-registry.test.ts` (updated) | registry covers `profiles`, `user_flags`, `reminder_settings`; detector still catches an unregistered table |
| integration | `auth/__tests__/profile.integration.test.ts` (5) | signup → exactly one `profiles` row with defaults; preference writes persist and bump `updated_at`; unknown keys and `plan` rejected at the query layer; consent is a timestamp, declining leaves null; step-by-step onboarding progress persists and resumes, decline path ends with `ai_consent_at = null` |
| integration | `auth/__tests__/service.integration.test.ts` (7) | sign-up lands on `/onboarding`; sign-in honours a safe `next` and rejects `//evil`; wrong password and unknown address yield the identical generic message; field validation makes no network call; per-email then per-IP sign-in limits trip; loopback skips IP buckets but not email buckets; magic link/reset always "sent" and rate-limit per email; **every log line carries only whitelisted keys, never an email address or password** |
| integration | `flags/__tests__/user-override.integration.test.ts` (2) | env default without a row; a `user_flags` row overrides for that user only |
| rls | `db/__tests__/profiles.rls.test.ts` (4) | trigger created the row; B/anon cannot read, B cannot update/delete, A cannot delete own; B cannot insert any profile; A updates preferences but `plan` → `42501` and value unchanged; service role can change plan |
| rls | `db/__tests__/user-flags.rls.test.ts`, `reminder-settings.rls.test.ts` | read-own-only pattern (A cannot insert/update/delete even own rows); standard isolation |
| e2e | `e2e/auth-security.spec.ts` (18 × 2) | 307 → `/sign-in` for every protected prefix, return-to carried; malformed session cookie → clean redirect (< 500); axe-clean `/sign-in /sign-up /forgot-password /reset-password /privacy`; error copy announced (`p[role=alert]`) and free of "no account/not found"; sign-up field errors set `aria-invalid`; Google button present and either leaves for the provider (stubbed) or shows the neutral message |
| e2e | `e2e/onboarding.spec.ts` (2 × 2) | **keyboard-only** (Tab/Enter, no clicks) sign up → Welcome → usage → resume-after-drop-off on step 2 → Back → forward → Skip experience → consent → `/reading/new` → Home; heading focused on every step; axe on every step + Home + Profile; sign out → sign in → Home (no onboarding); signed-in `/sign-in` bounces. Decline path: app works, Profile says Off, switch `aria-checked=false`, consent grantable/withdrawable, depth saves on change |
| e2e | `e2e/auth-email.spec.ts` (3 × 2) | password reset via real Mailpit mail → new password → old rejected (email kept in the form) → new accepted; magic link creates and signs in a new user → onboarding; bogus code → `/sign-in?link=expired` with neutral status |

Invariant tests unskipped this phase: none scheduled for Phase 01 (ledger unchanged).

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
$ eslint . && prettier --check . && tsx scripts/check-deletion-registry.ts
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  12 passed | 12 skipped (24)
      Tests  76 passed | 12 skipped (88)
Type Errors  no errors
 Test Files  4 passed (4)
      Tests  20 passed (20)

$ pnpm test:rls
 Test Files  4 passed (4)
      Tests  7 passed (7)

$ pnpm build && pnpm check:client-bundle
 ✓ Compiled successfully in 4.7s
+ First Load JS shared by all             103 kB
ƒ Middleware                              177 kB
check-client-bundle: ok (45 files scanned)

$ pnpm test:e2e          (mobile 390×844 + desktop; six consecutive runs after the last fix)
  56 passed (18.0s) · 56 passed (18.6s) · 56 passed (16.3s) · 56 passed (16.1s) · 56 passed (19.4s) · 56 passed (18.0s)

$ curl localhost:3100/api/health
{"status":"ok","db":true,"migration":{"current":true,"expected":"0002_auth_profiles"},"provider":{"provider":"mock",...}}

$ pnpm demo:seed   (run twice — idempotent)
seeding users (phase 01)
  demo-ana@tarot.local → 8b03f8ca-…   demo-ben@tarot.local → 1cc40ced-…
```

RLS harness proven to still detect a broken policy: with `alter table profiles disable row level
security` → `B must not read A's profiles row: expected [ Array(1) ] to have a length of +0 but got 1`;
re-enabled → 4 passed.

Route protection by hand (curl, production server):
```
/home             307 → /sign-in            /journal/abc?x=1   307 → /sign-in?next=%2Fjournal%2Fabc%3Fx%3D1
/onboarding       307 → /sign-in?next=…     /reading/new       307 → /sign-in?next=…
/sign-in /sign-up /reset-password /privacy /   200
garbage sb-127-auth-token cookie on /home → 307 /sign-in (no 500)
```

Google OAuth: `signInWithOAuth` returns the Supabase authorize URL and Supabase 302s to
`accounts.google.com/o/oauth2/v2/auth?client_id=…` — our side of the flow is exercised up to the
provider; completing it needs real credentials (see Deferred).

| Metric | Target | Measured |
|---|---|---|
| Signup → Home, automated (typing + 4 steps + stub) | < 60 s for a human | 4.05 s (mobile), 4.05 s (desktop) — `signup-to-home-ms` annotation |
| Taps after sign-up | one per step | 4 (Welcome, choice, Skip, consent) + 1 (Go to Home) |
| Unit suite | fast | 2.2 s |
| Integration / RLS | — | 3.8 s / 4.0 s |
| E2E (56 tests, 2 projects) | — | ~18 s |

Manual checks actually performed:
- [x] **Timed run**: automated run is 4 s; a human typing an email and a password then making four
      single-tap choices is comfortably inside a minute. Nothing was cut.
- [x] **Copy read aloud** (every onboarding string, sign-in/up, consent, Profile placeholders,
      `/privacy`). Rewrote the consent paragraph twice to remove "processing"/"data" register; the
      final text uses "send your readings and notes to an AI model", "the model never has the final
      word", "turn this off at any time". No word of it is legalistic.
- [x] **390 px screenshots reviewed** (sign-in, welcome, usage style, consent, home, profile light +
      dark): serif headings on paper, one primary action per screen, placeholders read as
      "coming in Phase NN" chips, not broken rows. Consent's two choices are visually equal-weight
      enough that declining does not feel punished.
- [x] **Keyboard only**: the onboarding spec never clicks; Tab order reaches every control, Enter
      submits, focus lands on each new step's heading (asserted).
- [x] `/dev/ui` gallery renders the new components light + dark (covered by the existing smoke axe test).
- [ ] PWA install on a physical phone — **still deferred** (no device in this session either).

## 9. UX notes

States: auth forms have pending (`aria-busy`, disabled submit), field error (announced, linked,
`aria-invalid`), form-level error (`role=alert`) and "sent" (`role=status`). Onboarding steps are
server-rendered; the only client work is heading focus. The consent switch is optimistic and reverts
with a message on failure; explanation depth saves on change with no separate Save button. Home has
two honest empty states that describe what will fill them. Profile placeholders each name their
phase. The privacy page is short, in second person, and only claims things a test or rule enforces.

Design system extended with `Field`, `FormMessage`, `ChoiceButton`, `FocusHeading`, `Switch`,
`SettingsSection/Row` (all in the gallery). Inline links are now always underlined.

Rough edges left deliberately: the magic-link/password toggle on sign-in is client state, so a
reload returns to the password form; `/reset-password` when not signed in shows a message rather than
redirecting (the recovery link is the only sane entry); `Sign out` is a plain form button (no
confirmation — signing back in is cheap and nothing is lost).

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Google OAuth completed end to end with real credentials | No Google client ID/secret in this environment. Code path, config, callback and redirect-to-provider are exercised; the last hop (Google → callback with a code) is the same `exchangeCodeForSession` path the magic-link e2e proves. Owner action: create OAuth credentials, export the two env vars, run the flow once. | Owner / Phase 12 launch checklist |
| Shared (cross-instance) auth rate-limit store | In-memory store is per server process; interface is ready. | Phase 12 |
| PWA install on a physical phone | No device | Phase 03 (first phase with a screen worth installing for) |
| `default_deck_id` FK to `decks` | Table lands in Phase 02 | Phase 02 |
| E2E-created users accumulate in the local database | Each run signs up ~8 fresh `@test.local` users; harmless locally, CI is ephemeral. A `pnpm db:reset`-style cleanup could purge `%@test.local`. | Phase 12 |

## 11. Known issues and risks

- **Per-IP limits are skipped for loopback.** Correct behind Vercel/any proxy that sets
  `x-forwarded-for`; on a bare deployment without that header every client shares the `unknown`
  bucket (over-limiting, never under). Revisit with the shared store in Phase 12.
- `middleware.ts` calls `supabase.auth.getUser()` (network) on every protected request, and the
  `(app)` layout calls it again through `getUser()` (memoised per request, but a second round-trip
  per page). Fine at this scale; Phase 12 can switch the layout to `getClaims()` once middleware
  validation is trusted.
- Middleware bundle is 177 kB (supabase-js on the edge runtime). Acceptable; watch it.
- Sign-up with email confirmations **enabled** (hosted default) returns "check your inbox" instead
  of redirecting; the e2e suite runs with confirmations off (local default). The callback handles
  both `code` and `token_hash` link styles, but the confirm-then-onboard path has not been driven
  end to end.
- React 19 form reset after actions bit once (email wiped). Any future form with an action must
  echo values it wants to keep.
- Supabase local `env(VAR)` substitution leaves the literal `env(…)` when the variable is unset; the
  Google provider then "exists" and redirects to Google with a bogus client id. Harmless locally,
  never true on a hosted project.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Open `/` → "Start your first reading" → `/sign-up`. Create an account; you land on
   "See how your readings connect over time." (Step 1 of 4).
2. Tab/Enter through the four steps; try Back and Skip; on step 4 pick either button → `/reading/new`
   → "Go to Home". `/home` shows one primary action and two empty slots.
3. `/profile`: flip "AI interpretation", change "Explanation depth", reload — both stick. Sign out.
4. `/home` while signed out → `/sign-in`. Sign in as `demo-ben@tarot.local` / `demo-password-123`
   → Home directly (onboarding done, AI off in Profile).
5. Sign-in → "Email me a sign-in link instead" → open `http://127.0.0.1:55324` (Mailpit) → follow
   the link. Same for "Forgot password?".

## 13. Notes for the next phase

- **Gate every AI call on `hasAiConsent(profile)`** (`src/db/queries/profile.ts`). The consent
  timestamp is the only switch; there is no boolean.
- `requireUser()` + `getSessionClient()` (`src/auth/session.ts`) are the way to read the caller in
  RSCs/actions; both are per-request memoised. `getProfile(client, user.id)` is one PostgREST call.
- New user-owned tables: write `pgPolicy` in the Drizzle schema, register in
  `deletionRegistry.ts`, add a `*.rls.test.ts` using the harness options (`ownerColumn`,
  `preexisting`, or `expectReadOwnOnly`). Attach `public.set_updated_at()` for `updated_at`.
- `drizzle-kit generate` needs a TTY when a table is dropped and another created (rename prompt);
  `(sleep 3; printf '\r'; …) | script -q /dev/null pnpm db:generate --name x` answers "create".
  Hand-written SQL goes after a `-- Hand-written` marker in the generated file.
- E2E: use `createReadyUser()` for specs that need a signed-in user, `signUpViaUi()` for flows that
  need onboarding, `freshEmail()` always (per-email rate limits are real), `latestEmailLink()` for
  mail. `expectNoSeriousA11y()` waits for `<title>`; keep using it after soft navigations.
- The onboarding hand-off is `FIRST_READING_PATH` (`/reading/new`); Phase 03 replaces
  `app/(app)/reading/new/page.tsx` and should keep the "your account is saved" tone if the draw fails.
- Phase 02 should add the `profiles.default_deck_id → decks` FK, enable the two "Deck preferences"
  rows in `app/(app)/profile/page.tsx` (`comingIn` → real controls) and may use `usage_style` to
  pick the default entry mode. These notes are now in the Phase 02 file.
