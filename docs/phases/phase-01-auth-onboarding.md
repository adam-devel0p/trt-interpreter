# Phase 01 — Auth, Profile & Onboarding

**Deps:** 00 · **Spec:** FR-01, §6.1, §11 · **Outcome:** a person can sign up, pass a four-step
onboarding in under a minute, and land on Home with their preferences stored — with database-level
proof that they cannot see anyone else's data.

## Scope

**In:** Supabase Auth (email/password + magic link + one OAuth provider), `profiles`, `user_flags`,
onboarding flow, Profile screen skeleton with privacy/AI-consent controls, route protection, RLS
baseline for user-owned tables.

**Out:** deck data (02) — onboarding's deck preference step stores a slug and resolves once decks
exist, or is ordered after 02 if you do 02 first. Subscription UI (11). Export/delete flows (05/12),
but the Profile screen reserves their place with disabled, labeled entries.

## Tasks

### 1. Auth
- Supabase Auth: email+password, magic link, and Apple **or** Google OAuth (pick one; the other is a
  config addition later). Never hand-roll password storage (§11).
- `/(auth)/sign-in`, `/sign-up`, `/forgot-password`, `/auth/callback`.
- Middleware protecting `(app)`; unauthenticated → sign-in with return-to. Authenticated users hitting
  `(auth)` bounce to Home.
- Session refresh handled server-side; no token in localStorage.
- Rate-limit auth endpoints. Generic error copy — never reveal whether an address exists.
- DB trigger `on auth.users insert` creates a `profiles` row (so a profile always exists).

### 2. Profiles and flags
- Migration: `profiles`, `user_flags`, `reminder_settings` (columns per
  [../DATA_MODEL.md](../DATA_MODEL.md#identity--preferences--phase-01)) with RLS policies.
- Drop the `smoke_notes` table from Phase 00 and move the RLS harness onto `profiles`.
- `src/db/queries/profile.ts`; server actions for each preference with Zod validation.
- Wire `src/flags/` to read `user_flags` overrides.

### 3. Onboarding (§6.1 — five screens, each skippable except consent)
Exactly this sequence, nothing added:
1. **Welcome** — one sentence: "See how your readings connect over time." One button.
2. **Usage style** — "I draw digitally" / "I use my own deck" / "Both". Changes defaults only, never
   feature access. Copy must say so.
3. **Experience level** — beginner / comfortable / experienced, explicitly optional, used only to tune
   explanation depth.
4. **Privacy & AI consent** — short, plain promise (private by default, AI processing is optional, you
   can export or delete everything) with one consent control and a link to the full policy. Sets
   `ai_consent_at`. **Declining is allowed** and takes the user to a fully working app without AI
   interpretation — build that path now, not later.
5. **Straight into the first reading.** Do not ask for life areas, people, goals or journeys (§6.1).
   In this phase the reading screen is Phase 03's stub; wire the handoff so it works when 03 lands.

Rules: progress is saved per step (a drop-off resumes, never restarts); each step is one thumb-reach
action; total time under a minute; back navigation works; no account-creation wall before the value
message.

### 4. Profile screen skeleton (§5)
Sections, with real controls where they exist and disabled labeled placeholders where they do not:
Account · Deck preferences (default deck, reversals on/off — enabled after 02) · AI & privacy (consent
toggle, explanation depth, "delete AI artifacts" placeholder) · Reminders (placeholder, Phase 11) ·
Subscription (placeholder, Phase 11) · Export & delete (placeholder, Phase 05/12) · About & policies.
Every placeholder says which is coming, none looks broken.

### 5. Home shell
Minimal but real: greeting-free header, a primary "Start a reading" action, an "unresolved reading"
slot (empty state now), and a "one relevant insight" slot (empty state now). Home must never look like
a dashboard (§4.3).

## Test plan

- [ ] Unit: onboarding state machine (step order, resume, skip, decline-consent path).
- [ ] Integration: signup creates exactly one `profiles` row; preference writes persist; consent
      timestamp recorded; declining consent leaves `ai_consent_at` null.
- [ ] **RLS** (`pnpm test:rls`): `profiles`, `user_flags`, `reminder_settings` — B cannot read or
      mutate A's row; anon blocked; a user cannot change their own `plan` column (server/service-role
      only). Add `profiles` to the standard isolation harness.
- [ ] Security: middleware blocks every `(app)` route unauthenticated (table-driven over the route
      list); expired session redirects cleanly; auth rate limit trips.
- [ ] E2E: sign up → 4 steps → Home, at 390px, **keyboard only**, then sign out → sign in → Home
      (onboarding not repeated). Second spec: decline AI consent → app works, AI surfaces absent.
- [ ] a11y: axe clean on every auth and onboarding screen; form errors announced; focus moves to the
      new step's heading on advance.
- [ ] No journal content in logs: assert auth/onboarding logs carry IDs only.

Manual:
- [ ] Time a real signup-to-Home run. If it exceeds ~60s, cut something.
- [ ] Read every word of onboarding copy aloud. Anything legalistic or vague gets rewritten (§6.1).

## Exit criteria

- [ ] Sign up / in / out / reset all work, including OAuth.
- [ ] Onboarding is 5 steps, resumable, skippable, keyboard-navigable, axe-clean.
- [ ] Declining AI consent yields a working, honest app.
- [ ] Profile screen present with real preference controls and labeled placeholders.
- [ ] RLS proven for all three new tables; `smoke_notes` removed.
- [ ] `pnpm demo:seed` creates two demo users with profiles.
- [ ] Report + `../PROGRESS.md` updated.
