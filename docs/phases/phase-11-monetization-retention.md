# Phase 11 — Metering, Subscription, Reminders & Share Cards

**Deps:** 10 · **Spec:** §14, §15, FR-24, FR-28, §19 · **Outcome:** the product can charge for analysis
without ever holding the user's own history hostage, and its retention loops are specific, useful and
easy to switch off.

## Scope

**In:** `usage_counters`, `subscriptions`, entitlements, paywall surfaces, Stripe Checkout + webhooks +
billing portal, trial, notification delivery (push/email), reminder preferences, privacy-safe share
cards, `analytics_events` with a validated allowlist.

**Out:** app-store billing (only if native ships), growth/SEO expansion beyond Phase 02's pages.

## Tasks

### 1. Entitlements and metering
- `src/domain/billing/entitlements.ts` — a single pure function `entitlements(plan, counters)` used by
  every gate. No feature check anywhere else in the tree (lint-enforced import restriction).
- Packaging per §14:
  | Free | Premium |
  |---|---|
  | Unlimited journal storage, digital + physical logging | Advanced historical analysis |
  | Basic interpretation allowance (metered per month) | Ask My History |
  | Basic search and recent history | Higher AI allowance / deeper model tier |
  | Simple recurring-card stats | Journey progression + long-range comparison |
  | Manual life-event logging | Outcome/correlation analysis |
  | **Full export and delete** | Monthly/yearly retrospectives |
- `usage_counters` incremented in `src/ai/telemetry.ts` (the budget hook built in Phase 00); limits
  enforced **before** the provider call.
- **From Phase 10:** summaries (`summarize_period`) and narratives (`journey_narrative`) are
  standard-tier calls made by jobs, not by views — meter them per generation; the explicit
  "Regenerate (one model call)" buttons on the retrospective and journey pages are the
  user-triggered path (`app/(app)/retrospective/actions.ts`, queued with `maxAttempts: 1`).
  Stored summaries, narratives and the retrospective screens must stay readable on any plan
  (invariant 11); only *new* generation is metered.
- **Invariant 11 — the archive is never paywalled.** Reading, searching, editing, exporting and deleting
  existing content work identically on an expired subscription. Only *new analysis* is limited.

### 2. Paywall UX (§4.8, §14)
- First reading, its interpretation and its saved timeline entry all complete **before** any payment
  surface appears — assert with an E2E spec that walks a brand-new user and fails if a paywall renders.
- Paywall placement: at the point of a premium action, explaining the specific value in that context
  ("Ask My History searches all 84 of your readings"), never as an interstitial or a launch wall.
- Annual-first with a monthly option, 7–14 day trial (§14), price near the mainstream journaling range;
  the exact number stays configurable, since §14 says not to optimise pricing before retention is shown.
- No dark patterns: cancellation is one tap to the portal, the trial end date is stated plainly, no
  countdown pressure, no fake scarcity.
- Limit-reached copy is honest and non-punitive, and always says what still works.

### 3. Stripe
- Checkout session creation, customer portal, webhook handler (idempotent, signature-verified,
  replay-safe) updating `subscriptions`.
- Statuses handled: trialing, active, past_due, canceled, unpaid; grace behaviour for past_due keeps
  **full archive access** and pauses only new analysis.
- Test-mode E2E through the whole lifecycle including a webhook replay.

### 4. Reminders and notifications (§15.2)
- Web Push (VAPID) + email fallback; `reminder_settings` from Phase 01 becomes real.
- Three reminder types, each individually switchable: **revisit due** (anchored to a specific old
  reading), **weekly reflection** (only after enough activity), **monthly retrospective**.
- Rules: quiet hours respected, at most one notification per day, no generic "come back" nags, every
  notification deep-links to the specific object it is about, one-tap unsubscribe from the notification
  itself. **No streak or loss-aversion framing anywhere** (§15.2, §4.7).

- **From Phase 10:** the in-app surfaces already exist and are switchable in Profile under
  "Looking back" — `reminder_settings.on_this_day / unresolved_review / journey_shifts /
  retrospectives` (default on, row created on first change). Delivery here means *pushing*
  what `src/retention/home.ts` picks (`loadHomeInsight`) and what `duePeriods()` /
  `listDueRevisits()` find; the fingerprints in `retention_prompts` are the "once per
  shift / once per day" memory to reuse, and a dismissal there must silence the notification
  too. The monthly retrospective notification deep-links to `/retrospective/YYYY-MM`; send it
  only when the period met the floor (`meetsSummaryFloor`) — a summary is optional, the
  screen stands without one. `pnpm jobs:summaries` is the local stand-in for the cron that
  enqueues `schedule_summaries`; the hosted cron needs that entry.

### 5. Share cards (FR-24, §15.1)
- "My month in tarot" and single-reading cards, rendered server-side into an image.
- **Excludes private notes, the exact question and entity names by default.** The user opts each element
  in and sees an exact preview of the final image before sharing (§11, FR-24).
- Never includes AI claims about real people. No user identity unless explicitly chosen.
- Designed to be genuinely attractive — this is the organic acquisition loop of §15.1, so treat it as a
  design deliverable, not a checkbox.

### 6. Analytics (FR-28, §19)
- `analytics_events` with a **per-event Zod allowlist**; no free-text property is representable, so
  journal content cannot be logged even by mistake.
- Events covering the §16 funnel: activation (reading started/completed, first save, time to first
  interpretation, physical vs digital), early value (reopened a reading, second reading within 7 days,
  first journey accepted), longitudinal value (confirmed link, outcome recorded, journey views, asks),
  AI quality (thumbs, correction rate, merge/split rate, rejected-correlation rate), monetization
  (paywall view, trial start, convert, renew), trust (export, delete, privacy page views).
- **Invariant `no-journal-content-in-logs.test.ts` — unskip and pass**, covering analytics props too.

## Test plan

- [ ] Unit: `entitlements()` truth table across plan × counters × feature; limit boundary behaviour.
- [ ] **Invariant `archive-readable-without-subscription.test.ts`** extended: expired and past_due plans
      retain journal, search, detail, edit, export and delete.
- [ ] Integration: counters increment per AI call and reset per period; limit blocks *before* the
      provider call (provider spy asserts zero calls when denied); webhook idempotency under duplicate
      and out-of-order delivery; subscription status transitions.
- [ ] **RLS** on `usage_counters`, `subscriptions`, `analytics_events`; a user cannot modify their own
      plan, counters or subscription rows.
- [ ] Share cards: default render contains no note text, no question text and no entity names (assert on
      the render payload, not just the image); opting in changes exactly what was opted into.
- [ ] Analytics: a deliberate attempt to log a `question` or `user_notes` value fails type-checking and
      is rejected at runtime.
- [ ] Notifications: quiet hours respected; max one per day; each links to the right object; unsubscribe
      works from the notification; disabling a type stops it.
- [ ] E2E: new user reaches a saved, interpreted reading with **no paywall shown** (spec fails if one
      renders); premium action → paywall → Stripe test checkout → entitlement granted; cancel → archive
      still fully accessible.
- [ ] a11y: paywall sheet is focus-trapped and dismissible by keyboard; price and trial terms are real
      text, not images.

Manual:
- [ ] Review every paywall and reminder string against §4.7/§4.8 and the copy rules. Anything coercive,
      urgent or guilt-shaped gets rewritten.
- [ ] Generate a share card and look at it as a stranger would. Would you post it? Does it leak anything?

## Exit criteria

- [ ] Single-source entitlements; metering enforced before provider calls.
- [ ] Stripe lifecycle working in test mode including webhook replay.
- [ ] Archive fully accessible on every non-paying state (tested).
- [ ] No paywall before the first saved, interpreted reading (tested).
- [ ] Three reminder types, individually switchable, non-coercive, deep-linked.
- [ ] Share cards private by default with exact preview.
- [ ] Analytics allowlist prevents content logging by construction.
- [ ] Report + `../PROGRESS.md` + `../PRIVACY_AND_DELETION.md` (share-card rules as built).
