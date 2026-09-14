# Phase 11 — Completion Report

**Status:** complete with deferrals (the real Stripe test-mode run, live Web Push / email delivery and the §22 study need the owner's keys and people — everything is wired and proven against the fake provider, the logged senders and the mock model; see §10)
**Date:** 2026-09-14
**Phase file:** [../phase-11-monetization-retention.md](../phase-11-monetization-retention.md)

---

## 1. What was built

The product can now charge for analysis without ever holding the journal hostage. **One pure
function** — `entitlements(plan, counters)` in `src/domain/billing/entitlements.ts` — is the
only feature check in the tree (a lint rule restricts its import to `src/billing/` and the AI
budget hook); every gate reads one `FeatureEntitlement` from it. **Metering** is real: the
budget hook built in Phase 00 (`DbBudgetPolicy` in `src/ai/telemetry.ts`) runs before every
provider call, denies with a reason (`plan` / `monthly` / `daily`) and makes zero provider
calls when it does; `usage_counters` are written after every run that reached the provider
(a unit is consumed only on `ok`), one row per UTC day and task so a month resets by
arithmetic. Free keeps the whole journal, digital and physical logging, 10 interpretations a
month, search, symbols, events, outcomes, export and delete; Premium adds Ask My History,
summaries and narratives, the reasoning behind suggested connections, 300 interpretations a
month on the deeper tier. **Nothing that reads, edits, exports or deletes stored content
touches the gate** — the invariant tests now enumerate the files that may. **Stripe** is
behind a provider seam (`src/billing/`): Checkout, the customer portal (cancellation is one
tap there) and a webhook that is signature-verified, idempotent by event id, safe under
out-of-order delivery and mirrors the plan onto `profiles.plan`; a **fake provider** runs the
same lifecycle through the same handler on local pages, so the whole thing is exercised end
to end without a key. The **paywall** appears only at a premium action, in its context,
annual first with a monthly option, the trial end date in plain text, nothing coercive, and
always says what still works; a used-up allowance keeps the reading and says so honestly.
**Reminders** deliver what Phase 10 already picked: a revisit that is due, the month to look
back on, a week worth reflecting on — each anchored to one object with a deep link, at most
one a day, never in quiet hours, each individually switchable, each message carrying its own
one-tap unsubscribe; Web Push (VAPID) with email as the fallback, and content-free by rule.
**Share cards** — a reading, "My month in tarot" — are rendered server-side as PNGs from a
payload that excludes the note, the question and every name unless opted in, previewed as the
exact final image, never given a public URL. **Analytics** is a per-event Zod allowlist with
no string field anywhere, so journal content cannot be logged by construction; the §16 funnel
is wired through the existing actions. The `no-journal-content-in-logs` invariant is live.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **A provider seam with a fake provider** (`BILLING_PROVIDER=fake`): local checkout and portal pages emit Stripe-shaped events, sign them with the webhook secret and hand them to the real handler | No Stripe keys in any environment (as with the AI provider since 04); this way the handler, the signature check, the ledger and the UI are proven by tests, and the real adapter differs only in where the URLs point. Refused in production. | Mocking `stripe` in tests only (would leave the route and the pages untested); waiting for keys |
| **The official `stripe` SDK** for Checkout, the portal and `constructEvent` | Constant-time signature verification with a tolerance window, and `generateTestHeaderString` lets the fake sign bodies with the same scheme | A hand-rolled fetch client and HMAC (fewer dependencies, more surface to get wrong) |
| **`past_due` = premium analysis paused, archive untouched** (`effectivePlan` → `free`) | The phase file: "grace behaviour for past_due keeps full archive access and pauses only new analysis"; the archive has no gate at all, so "free" is exactly that | A grace period that keeps premium running (would bill nothing and pay for calls) |
| **Counters are per UTC day; a month is the sum of its days; only `ok` runs consume a unit** | One table answers both the monthly allowance and the day cap; a failed generation must not cost the user; "reset per period" needs no job | A monthly row per task (cannot express the day cap); counting attempts |
| **Support tasks (`classify_safety`, `detect_repeat_question`) have no monthly bucket** | An interpretation is two or three model calls; the allowance must count interpretations, not calls | Counting every call (10 interpretations would be 5) |
| **Memory extraction stays free but cost-capped** (300 / 1500 a month) | Extraction is the substrate journeys and correlation rest on; gating it would leave a free user's history empty when they upgrade | Making extraction premium |
| **Deterministic journeys, progression, recurring symbols and correlation *suggestions* stay free; the model's sentence on a suggestion, Ask and summaries are premium** | §4.8 and the reading-to-reality loop: the free tier must show the longitudinal value before asking; the phase table's "journey progression" and "correlation analysis" are read as the *generated* parts | Paywalling the journey screen (a wall on the product's centrepiece) |
| **The interpretation limit is checked in the route before the pending row, and the runner's hook stays as the backstop** | The panel can show the exact count without a `pending` → `failed` row; the hook still guarantees no provider call even from a job | Relying on the hook alone (an honest but roundabout failure) |
| **Premium interpretations use the `deep` tier via `modelHint`** | §14 "deeper model"; one line in the service, the routing table decides which model that is | A separate task |
| **The summary sweep skips users the gate would refuse** | No `budget_denied` noise in `ai_calls` for jobs that were never going to run; the narrative job from `refreshJourneys` still runs through the hook and fails soft | Letting every job hit the hook |
| **Reminders are content-free**: dates, counts, deck name, a deep link — never the question or a note | Push text sits on lock screens, email passes a third party; the deep link renders the words | Quoting the question in the reminder |
| **The reminder log stores app-authored copy** (`notifications.title/body`) | It is the once-only memory and what Profile lists; since copy is content-free by rule and test, storing it is safe and makes the e2e assertable | Storing ids only and re-rendering |
| **`channel = 'push'` means push with email as fallback**; nothing is sent while `none` (the default) | A user who allowed push but whose device is gone still gets the one reminder they asked for; the default is silence | A separate email-fallback switch; defaulting to email |
| **Signed one-tap links** (HMAC over purpose · user · kind) for unsubscribe and open, no session | "Unsubscribe from the notification itself" must work from a lock screen or a mail client | A login round-trip |
| **Share cards: no public URL, the user gets a file** | §11; a hosted image would be a leak by construction and a moderation surface | Hosted share links |
| **Share cards never carry generated text** | "Never includes AI claims about real people" is easiest to guarantee by never including AI text at all | Showing the summary headline with an opt-in |
| **Share cards are gated by `share_cards` (env default off; rollout per user)** | The flag exists since 00; the acquisition loop can be switched on per cohort | Always on |
| **Analytics props: closed enums, booleans, bounded integers and uuids only** | FR-28 by construction; a string field would be a channel | Allowing short strings with scrubbing |
| **`ai_calls`-style no-policy tables for `billing_events` and `analytics_events`; read-own for counters, subscriptions and notifications** | Users should see their allowance, plan and reminders; the ledgers are ops surfaces | Read-own everywhere |

## 3. Files and modules

```
src/domain/billing/ ★
  entitlements.ts ★    PlanId, Feature, TASK_FEATURE, FEATURE_PLAN, PLAN_LIMITS, entitlements(), effectivePlan(), checkFeature()
  pricing.ts           Pricing, priceLines (annual first), describeSubscription (one plain sentence per state)
  providerEvents.ts    normalizeStripeEvent (checkout / subscription events, both API shapes), transitionEvent (funnel step)
  __tests__/           entitlements truth table, pricing, providerEvents
src/domain/analytics/events.ts ★   ANALYTICS_EVENTS (per-event strict Zod, no string leaf), validateAnalyticsEvent, ageBucketOf; __tests__ (+ events.test-d.ts)
src/domain/notifications/
  rules.ts ★           REMINDER_KINDS, pickReminder (switches, sent, dismissed, priority, day cap, quiet hours), inQuietHours, localParts, windows
  copy.ts              revisit / monthly / weekly copy, REMINDER_KIND_LABEL, BANNED_REMINDER_PHRASES, violatesReminderCopy
  __tests__/rules.test.ts
src/domain/share/payload.ts ★      ShareOptions (private defaults), buildReadingCard, buildMonthCard, excerpt, parse/query helpers; __tests__
src/billing/ ★
  provider.ts          BillingProvider seam (createCheckout, createPortal, parseWebhook), BillingSignatureError
  stripe.ts ★          the SDK adapter; signWebhookBody / verifyWebhookBody (shared with the fake and tests)
  fake.ts              local pages as checkout and portal; relative URLs; refused in production by index.ts
  fakeEvents.ts        Stripe-shaped event builders (checkout completed, subscription created/updated/deleted)
  index.ts             getBilling() by BILLING_PROVIDER; pricing()
  config.ts            pricing from env, siteUrl
  gate.ts ★            loadEntitlements(userId), checkFeatureFor — the one place a plan becomes a verdict
  offer.ts             paywallOffer(userId, feature): verdict + prices + trial availability for a page
  usage.ts ★           recordUsage (upsert per UTC day/task), readUsage (month by feature, today)
  subscriptions.ts ★   loadSubscription, applyBillingEvent (ledger → user → ordering guard → upsert → plan mirror → funnel event)
  webhook.ts           handleWebhookBody (signature → normalise → apply) shared by the route and the fake pages
  __tests__/billing.integration.test.ts ★
src/analytics/track.ts ★           track (typed, fire-and-forget) / trackNow (validated, service-role insert)
src/notifications/
  dispatch.ts ★        dispatchReminders: users with a channel → candidates (revisits, month, week) → pickReminder → send (push per device, email fallback) → record → track
  senders.ts           PushSender / EmailSender; web-push (VAPID) and Resend when live; log senders otherwise; setSendersForTests
  links.ts             signToken / verifyToken, unsubscribeUrl, openUrl
  __tests__/notifications.integration.test.ts ★
src/share/
  load.ts              loadReadingForShare / loadMonthForShare (as the user), loadArt (WebP → PNG data URIs via sharp)
  render.tsx ★         ReadingCard / MonthCard for next/og (1080 × 1350), shareFonts (Newsreader + DM Sans WOFF)
  __tests__/share.integration.test.tsx
src/ai/telemetry.ts    DbBudgetPolicy ★ (the real budget), DbTelemetry writes usage_counters; index.ts wires the budget
src/interpretation/service.ts   modelTier → modelHint
src/summaries/schedule.ts       eligibleUsers filtered by the gate
src/db/schema/billing.ts ★, notifications.ts ★; migrations/0012_billing_notifications.sql ★
src/db/queries/billing.ts (own subscription, monthly usage), reminders.ts (prefs, push registrations, recent reminders)
src/db/__tests__/billing.rls.test.ts ★
src/domain/privacy/deletionRegistry.ts  six tables under the user root
src/ui/components/premium-offer.tsx ★ (PremiumOffer, PaywallCard, PaywallSheet), share-studio.tsx ★, theme-colors.ts (+SHARE_PALETTE)
src/config/env.server.ts (+billing, notification env), env.ts (+NEXT_PUBLIC_VAPID_PUBLIC_KEY)
eslint.config.mjs      NO_ENTITLEMENTS_OUTSIDE_BILLING
app/api/billing/webhook/route.ts ★
app/api/notifications/unsubscribe/route.ts, open/route.ts; app/notifications/unsubscribed/page.tsx
app/api/share/reading/[id]/route.tsx ★, month/[period]/route.tsx
app/(app)/billing/  checkout-actions.ts ★ (startCheckoutAction, openBillingPortalAction, notePaywallViewedAction), actions.ts (fake events), checkout/page.tsx, portal/page.tsx
app/(app)/profile/  billing-section.tsx ★, reminder-controls.tsx ★, reminder-actions.ts, page.tsx (Subscription + Reminders sections)
app/(app)/ask/page.tsx (PaywallCard in place of the composer), ask-composer.tsx (plan / limit copy); app/api/ask/route.ts (gate)
app/(app)/retrospective/actions.ts (gate in canGenerate), controls.tsx (PremiumGate → PaywallSheet), [period]/page.tsx (+share link); journey/[id]/page.tsx
app/(app)/reading/[id]/interpretation-panel.tsx (limit copy), page.tsx (+Share as an image, reading_reopened), share/page.tsx; retrospective/[period]/share/page.tsx; app/(app)/share-actions.ts
app/api/readings/[id]/interpret/route.ts   the pre-check, modelTier, interpretation_completed
public/sw.js           push + notificationclick (open / one-tap unsubscribe action)
scripts/seed-demo-billing.ts (Ana premium yearly, reminders, share flag), jobs-reminders.ts (`pnpm jobs:reminders`), gen-vapid-keys.ts (`pnpm notifications:keys`)
e2e/billing.spec.ts ★, reminders-share.spec.ts ★, _helpers.ts (+premium, share)
Tests: invariants no-journal-content-in-logs ★ (live), archive-readable-without-subscription (+gate-importers list; integration +exhausted limits × 4 states); fixtures memory-db (+grantPremium, seedUsage)
```

## 4. Database changes

`0012_billing_notifications.sql` (`drizzle-kit generate --name billing_notifications`, two
`set_updated_at` triggers hand-written after the marker), applied locally:

- `usage_counters` (unique `(user_id, period_start, task)`, non-negative check; RLS select own).
- `subscriptions` (`user_id` unique; unique `(provider, provider_customer_id)`; status / plan /
  interval checks; RLS select own). `profiles.plan` keeps its Phase 01 protect trigger and is
  mirrored by the webhook.
- `billing_events` (`id text` primary key = provider event id; RLS enabled, no policies).
- `analytics_events` (name check `^[a-z][a-z0-9_]{2,63}$`; RLS enabled, no policies).
- `push_subscriptions` (`endpoint` unique; four policies).
- `notifications` (unique `(user_id, kind, fingerprint)`; kind / channel / status checks; RLS
  select own).
- DATA_MODEL.md's platform section rewritten to the built shape; `reminder_settings` paragraph
  updated (`push` = push with email fallback). Deletion registry: all six under the `user` root
  (`billing_events` set-null like `ai_calls`).

## 5. AI tasks touched

No prompt or schema changed. Every task is now metered under a feature (`TASK_FEATURE`), and
`interpret_reading` runs on the `deep` tier for premium users via `modelHint` (the routing
table decides the model). `pnpm eval --dry` unaffected.

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `PLAN_LIMITS.free` | `domain/billing/entitlements.ts` | 10 interpretations / 300 memory / 0 analysis a month, 120 a day, `standard` tier | §14 placeholder until retention data (open question); boundary unit tests |
| `PLAN_LIMITS.premium` | same | 300 / 1500 / 300 a month, 500 a day, `deep` tier | same |
| `DEFAULT_PRICING` / env | `domain/billing/pricing.ts`, `BILLING_*` | €5.99 a month, €39.99 a year (44 % less), 14-day trial | §14 "near the mainstream journaling range, annual-first, 7–14 day trial"; configuration, not code |
| Webhook signature tolerance | Stripe SDK default | 300 s | integration: a signature an hour old is refused |
| `WEEKLY_REFLECTION_DAYS` / `MONTHLY_RETROSPECTIVE_DAYS` / `WEEKLY_REFLECTION_MIN_ENTRIES` | `domain/notifications/rules.ts` | ISO days 1–2 / first 7 days / 3 | "weekly reflection only after enough activity" = the weekly summary floor; integration |
| One reminder per local day; quiet hours `[start, end)` | same | — | unit + integration |
| `NOTE_EXCERPT_MAX` / `QUESTION_MAX` | `domain/share/payload.ts` | 160 / 120 chars | fits the 1080-px card at the chosen type size |
| Card size | `share/render.tsx` | 1080 × 1350 | 4:5, the common feed format |

ALGORITHMS.md gained §9.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/billing/__tests__/entitlements.test.ts` (10) | the plan × feature truth table; one-under passes, at-limit denies with `monthly`; the shared analysis bucket; the day cap (`daily`) and monthly-beats-daily; support unbucketed; memory cost-capped; the tier; `effectivePlan` for every status; `featureForTask` covers all tasks |
| unit | `pricing.test.ts` (3), `providerEvents.test.ts` (6) | currency formatting, annual first with saving, every subscription state as one plain sentence without pressure vocabulary; both Stripe API shapes, expanded customer, deleted → canceled, checkout binding, ignored / malformed / unknown status / non-uuid user; the funnel transitions |
| unit | `domain/analytics/__tests__/events.test.ts` (4) + `events.test-d.ts` | no schema has a string leaf; every event rejects a smuggled `question` / `user_notes`; bounded numbers; age buckets; **type-level**: no event type has a string member, a content key is a compile error |
| unit | `domain/notifications/__tests__/rules.test.ts` (6) | quiet windows (same-day, overnight, empty); local parts by zone; channel off / nothing due; switches, sent and dismissed silence; priority; day cap and quiet hours hold; every copy string passes the banned-phrase scan |
| unit | `domain/share/__tests__/payload.test.ts` (5) | **default reading card has no note, question or name anywhere in the JSON**; each opt-in changes exactly itself; Thoth keeps its names, no art; month card defaults and opt-ins; excerpts, query round-trip |
| unit (invariant) | `no-journal-content-in-logs.test.ts` (5, **unskipped**), `archive-readable-without-subscription.test.ts` (+1) | see TESTING.md; the exact list of gate importers |
| integration | `billing/__tests__/billing.integration.test.ts` (5) | counters: only `ok` consumes, tokens accrue, last month does not count; **a limit blocks with zero provider calls** (mock call log), a support task still runs, a premium task is refused for the plan then runs once premium; webhooks: duplicate → no-op, stale → ignored while state stays, trialing → active → past_due (premium paused, interpretation allowed) → deleted → canceled by customer id alone, ledger outcomes, funnel events, `no_user`, `ignored_unknown`; the HTTP body path: missing / wrong / stale signature 400, applied then duplicate, bad shape 400; analytics refuses a content prop at runtime |
| integration | `notifications/__tests__/notifications.integration.test.ts` (6) | one due revisit → one content-free email with the open and unsubscribe links, deep-linked, not repeated; quiet hours hold then send, the day cap holds the second, next day sends; switch off stops, no channel means no user seen, the unsubscribe route rejects a forged token and flips exactly one switch; push to devices with links in the payload, email fallback with no device, a 410 disables the device; month and week reminders in their windows only, silenced by an in-app dismissal; the open link records once and redirects, forged → Home, the RLS-read row carries no content |
| integration | `share/__tests__/share.integration.test.tsx` (2), `archive-readable…integration` (+1) | owner-only load, private default from real rows, a PNG of the right size with art; Thoth without art; the archive under four non-paying states with every allowance exhausted |
| rls | `db/__tests__/billing.rls.test.ts` (5) | counters and subscriptions read-own and immutable to the user (and `profiles.plan` still `42501`); `billing_events` and `analytics_events` invisible; `push_subscriptions` four-policy isolation; `notifications` read-own |
| e2e | `e2e/billing.spec.ts` (3 × 2), `e2e/reminders-share.spec.ts` (2 × 2) | see §8 |

Invariant tests unskipped this phase:
- [x] `no-journal-content-in-logs.test.ts` — logger, Sentry scrubber, analytics allowlist (runtime + type level), reminder copy, structural sweep.
- [x] `archive-readable-without-subscription` extended to exhausted limits and every non-paying state.

## 8. Verification evidence

```
$ pnpm lint
eslint . && prettier --check . && tsx scripts/check-deletion-registry.ts
All matched files use Prettier code style!
check-deletion-registry: ok
$ pnpm typecheck
tsc --noEmit                                   (clean)
$ pnpm test:unit
Test Files  50 passed · Tests  344 passed · Type Errors  no errors
$ pnpm test:integration
Test Files  23 passed · Tests  143 passed
$ pnpm test:rls
Test Files  14 passed · Tests  59 passed
$ pnpm build && pnpm check:client-bundle
✓ Compiled successfully · check-client-bundle: ok (88 files scanned)
$ pnpm test:e2e
138 passed (3.2m) — mobile 390 px + desktop, axe on every new screen; first full run had one demo-user flake (both projects driving demo-ana in parallel) that passed on rerun and on the second full run
```

(`pnpm test` = unit 344 + integration 143 = 487.)

| Metric | Target | Measured |
|---|---|---|
| Provider calls when the budget denies | 0 | 0 (mock call log, integration; `ai_calls.interpret_reading` = 0 in e2e at the limit) |
| Webhook replay | idempotent | second delivery → `duplicate`, row unchanged (integration + HTTP in e2e) |
| Out-of-order webhook | older event ignored | `ignored_stale`, status stays `active` |
| Paywalls before the first saved, interpreted reading | 0 | 0 across sign-up → onboarding → new reading → save → interpretation → detail → Home → journal (e2e, both viewports) |
| Reminders per user per local day | ≤ 1 | 1 (second candidate held, sent next day) |
| Share card render (3 RWS cards, fonts cached) | — | ~1.0 s cold in the integration run (font + art decode), ~0.1 s warm |
| Default share payload content | none | no note, question or name in the JSON (unit + integration) |

Manual checks actually performed:
- [x] **Every paywall and reminder string read against §4.7 / §4.8.** Paywall: value sentence for the context, annual first, the trial end as a date, "cancel there in one tap", the archive line on every variant, "Not now" as the secondary; no countdown, scarcity, guilt or exclamation. Limit copy: "No new interpretation this time — your reading is saved. Free includes 10 interpretations a month and you have used 10. Your reading, your notes and every earlier interpretation stay readable, and the reference meanings below are always here. The count starts again on the first of the month; Premium raises it." Reminders: "A reading is ready to revisit — You set a revisit date for a Rider–Waite–Smith reading from 1 June 2026. Whether anything came of it is yours to say — 'unresolved' is a fine answer." The first draft of the revisit body said "come back to" and was caught by the banned-phrase test; rewritten. The Profile section's first draft said "no streaks" — a word the e2e forbids on the page — rewritten to "Nothing here counts days."
- [x] **Generated share cards and looked at them as a stranger would** (the three renders in §8 of this session: an RWS reading with the question opted in, a Thoth reading with defaults, an August month card). Default reading card: date, three cards with art, names and positions, theme chips, deck and spread — nothing of the person. With the question on: the question in the serif, still no note or name. Thoth: the typographic face in the violet accent, its own names. Month: the month in large serif, three plain numbers, "Kept coming back", theme chips, "From a private journal, shared by choice". Would I post them: the RWS one yes; the Thoth face is coherent with the app but plainer than the art — a commissioned Thoth deck (LICENSING.md) would lift it. The first renders failed on `border: double` and `transform: undefined` in satori; fixed to solid + nested frame and conditional transform.
- [x] **390 px, light and dark:** Ask with the paywall card (radio rows stack, prices readable), Profile Subscription + Reminders sections, the sheet on Profile (scrolls inside the viewport, `max-h: calc(100dvh - 2rem)`), the share studio (preview at 100 % width, ≤ 24 rem), the fake checkout and portal. Nothing overflows.
- [x] **Keyboard / screen reader:** the sheet is a Radix Dialog (focus trapped — proven by 12 Tabs in e2e — Escape closes, focus returns to "See Premium"); prices and trial terms are text; radio rows are real radios in a fieldset with a legend; the reminder switches are `role=switch` labelled by their row; the studio's preview `<img>` has alt text and a caption; the unsubscribe landing has an `h1` and one link. axe clean on Ask (paywall), the reading at the limit, Profile (both sections), the share studio and the landing page (e2e).
- [ ] **Real Stripe test mode** (Checkout, portal, live webhook with `stripe listen`) — owner; needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, two price ids.
- [ ] **Live push on a phone / email through Resend** — owner; `pnpm notifications:keys`, `NOTIFICATION_DELIVERY=live`.

## 9. UX notes

The four states: the paywall is not a state of a component but a replacement for the control
(card) or a dialog from it (sheet); the limit is a `failed` mode of the interpretation panel
with its own heading and a link instead of "Try again"; the share studio has a loading
`<img>` (the browser's own) and one error line; the reminder controls flip optimistically and
revert with a message; Profile's Subscription section shows a success or unavailable notice
from the return query. The fake checkout / portal pages are deliberately plain and say "Nothing
is charged anywhere".

Rough edges left deliberately: the paywall's "Premium adds" list is static copy (it should
one day count *this* journal's journeys and open questions); the sheet's price radios are
native inputs with the accent colour rather than a custom control; `PushDeviceControl` reports
"Not set up on this deployment" without a VAPID key, which is honest but a dead row locally;
"Recent reminders" lists titles only; the month card has no art (a small card fan would
help); the Thoth typographic face on the card is simpler than the app's `Card` component.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Real Stripe test-mode lifecycle (Checkout, portal, `stripe listen` → webhook, replay from the dashboard) | No keys in any environment; the adapter is the SDK's three calls and is exercised only through the fake provider and `constructEvent` with test signatures | owner (any time): set `BILLING_PROVIDER=stripe`, the four `STRIPE_*` vars, run `e2e/billing.spec.ts` against test mode |
| Live Web Push and email delivery (`NOTIFICATION_DELIVERY=live`) on a real device | No VAPID / Resend keys; the senders are thin and the dispatcher is proven with spies | owner (any time): `pnpm notifications:keys`, Resend key |
| Hourly cron entry for `deliver_reminders` (with `schedule_summaries`) | Ops; `pnpm jobs:reminders` is the local stand-in; `vercel.json` only runs the batch | 12 |
| **§22 validation study** and the pricing numbers it should inform | A study, not code; the numbers are env configuration so they can move without a deploy of logic | owner |
| Region-aware safety resources (carried from 04) | No region signal yet; the billing country from Stripe could be one | 12 |
| App-store billing | Only if native ships (phase file: out) | — |
| `PremiumOffer` / `ShareStudio` / reminder controls in `/dev/ui` | Islands bound to actions and data | 12 |
| Analytics funnel dashboard (`/dev/analytics`) and the AI-cost-per-paying-user view | Events are written; reading them is a dev page | 12 |
| `interpretation_completed.first` is "not a regeneration", not "first ever for the user" | Would need a count query in the stream loop; the activation funnel can derive it from `reading_completed.first` | if needed |
| A `usage_counters` pruning job (rows older than a year) | Small rows; nothing reads them after the month | 12 ops |

## 11. Known issues and risks

- **The fake provider's success/cancel URLs must be relative** (the e2e server's port is not
  `NEXT_PUBLIC_SITE_URL`); the real Stripe adapter gets absolute URLs. Caught by the e2e when
  the first run landed on `localhost:3000`.
- **The ordering guard is per subscription row**: two different subscriptions for one user
  (a cancelled one, then a new checkout) share the row; a stale event of the old one with a
  newer timestamp than the new one's cannot happen in Stripe's ordering, but the guard would
  not catch it either. Stripe emits at most one active subscription per customer here.
- **`checkout.session.completed` sets `status = 'incomplete'` when it arrives before the
  subscription event** (usually it does not); the subscription event that follows within
  seconds sets the real status. Profile shows "A checkout was started but not completed" for
  that window.
- **Trial availability is per user, not per customer**: `trial_used_at` on the row. Deleting
  the account and signing up again would get a second trial — acceptable.
- **The day cap is UTC**, like the month; a user in UTC+12 sees "resets at midnight UTC".
- **Push subscriptions from browsers are trusted as given** (endpoint URL and keys); the
  dispatcher disables an endpoint on 404/410 and never re-enables it (the user re-allows).
- **`sharp` moved to runtime dependencies** for the WebP → PNG decode (satori cannot read
  WebP); ~0.1 s per card warm. Fonts are read from `node_modules/@fontsource/*` at runtime —
  fine on Vercel's Node runtime, not on the edge runtime (the routes are Node).
- **`retention_prompts` and `notifications` share fingerprint semantics only for the month**
  (`retrospective|YYYY-MM`); the in-app on-this-day and shift surfaces have no notification twin
  (by design: those are not reminders).

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste keys into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Sign in as `demo-ben@tarot.local` / `demo-password-123` (Free) → Ask → the paywall card in
   place of the composer ("Ask my history searches all N of your readings…", €39.99 a year
   first, €5.99 a month, "Free until <date>") → *Start 14 days free* → the test checkout →
   *Complete test purchase* → back on Ask with the composer → Profile → "Premium trial until
   <date>…" and *Manage billing* → the test portal → *Cancel now* → Profile says Free, the
   journal, search, every reading and export work as before.
2. `demo-ana@tarot.local` (Premium yearly): Profile shows "Premium, yearly. Renews <date>." and
   the analysis allowance; the retrospective's *Regenerate (one model call)* runs; Ask works.
3. Free user at the limit: in Supabase Studio insert `usage_counters (user_id, period_start =
   today, task = 'interpret_reading', calls = 10)` → save a new reading → "No new interpretation
   this time — your reading is saved." with the count; the cards and meanings are there.
4. Profile → Reminders → channel *Email* → set a revisit date in the past on a reading → `pnpm
   jobs:reminders` → the reminder appears under *Recent reminders* (delivery is logged, not
   sent, without keys) and links to the reading; the row's `body` in Studio names the date,
   not the question. Open the unsubscribe URL from `notifications` (build it with
   `unsubscribeUrl` or copy from a live email) → "Turned off." → the switch is off in Profile.
5. Ana → a reading → *Share as an image* → the exact preview; tick *The question* → the image
   changes; *Download image* → a PNG. `/retrospective/<last month>` → *Share* → the month card.
6. `pnpm eval --dry` unchanged; `pnpm exec eslint src` fails if any file outside `src/billing/`
   imports `@/domain/billing/entitlements` (try it).

## 13. Notes for the next phase

- **Hardening (12):** cron entries for `deliver_reminders` (hourly) and `schedule_summaries`;
  the per-object locks; `retention_prompts` / `usage_counters` pruning; a `/dev/analytics`
  funnel page over `analytics_events`; the account-deletion job must delete
  `push_subscriptions`/`notifications`/`subscriptions` (all cascade) and, for a Stripe
  customer, cancel the subscription through the API before deleting the user (a
  `cancelSubscription` method on the provider seam is the missing piece).
- **Security review (12):** the webhook route is unauthenticated by design (signature is the
  auth); the unsubscribe / open routes are token-authorised; the fake billing pages are
  `notFound()` unless `BILLING_PROVIDER=fake` and `getBilling()` refuses the fake in
  production — check both in the review. `NOTIFICATION_SIGNING_SECRET` should be set in
  production rather than falling back to `JOBS_RUN_SECRET`.
- **Owner:** `BILLING_PROVIDER=stripe` needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, and the webhook endpoint
  `/api/billing/webhook` subscribed to `checkout.session.completed` and
  `customer.subscription.created|updated|deleted`. Prices shown come from `BILLING_*`; keep
  them equal to the Stripe prices.
- These notes were added to the Phase 12 file.
