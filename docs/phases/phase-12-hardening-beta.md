# Phase 12 — Hardening, Privacy Audit, Accessibility & Beta

**Deps:** 11 · **Spec:** §18 Phase 7, §19, §11, §13, §22 · **Outcome:** every acceptance criterion in
§19 is verified by a test or a documented check, the privacy and security posture is audited, the app is
accessible and fast, and a beta cohort can be onboarded with confidence.

## Scope

**In:** security review, full privacy/deletion/export completion, accessibility audit, performance and
load/cost testing, the complete eval suite, analytics dashboards, migration/runbook documentation, UX
polish pass, beta onboarding.

**Out:** native apps, anything in §17's deferred list.

## Tasks

### 1. §19 acceptance-criteria audit
Produce `docs/ACCEPTANCE.md`: every criterion in spec §19 mapped to the test file or documented manual
check that proves it, with its current status. **Any criterion without a proof is work to do in this
phase, not a footnote.** The list:
first-time user saves a reading with no manual tagging · physical 3-card log under a minute · Thoth
displays and interprets natively · a journey spans both decks preserving identity · opening an old
reading needs no AI call · AI outage still saves the reading · confirmed vs inferred vs interpretation
distinguished in persistence and prompts · historical answers return source IDs or state insufficiency ·
deleting a reading removes derived data · aliases resolve without overwriting historical roles · a
rejected correlation is not re-suggested without new evidence · summaries never cite a summary as sole
evidence for a real event · users access their own text regardless of plan · no raw journal content in
logs or analytics.

### 2. Security review
- Run the `/security-review` skill over the whole tree, plus manual review of: authorization on
  every route handler and server action, service-role usage, signed-URL scoping and expiry, webhook
  signature verification, rate limits (auth, AI, export, ask), CSP and security headers, dependency
  audit, secret handling, SSRF/injection surfaces on any user-supplied URL or file.
- Re-run the **full** `pnpm test:rls` suite and confirm every user-owned table is covered — compare the
  table list in the database against the suite programmatically, not by eye.
- Penetration-style checks: cross-user ID substitution on every mutating endpoint; IDOR on media and
  export URLs; JWT expiry/replay; attempting to write `plan`, `fact_status='CONFIRMED_FACT'`, or another
  user's `user_id` directly.

### 3. Privacy completion
- Finish the deletion flows from [../PRIVACY_AND_DELETION.md](../PRIVACY_AND_DELETION.md): delete-all-
  history and delete-account, both with double confirmation, full purge including storage and auth
  identity, and a receipt.
- Re-run the deletion-registry completeness test against the final schema.
- Export v2: human-readable Markdown + PDF (FR-22) alongside the JSON.
- Consent revocation path: stops processing, offers derived-artifact deletion, keeps raw entries.
- Write the user-facing privacy page in plain language: what is sent to which model provider, what is
  stored, retention, backups, deletion timelines, and what the support team can and cannot see (§11).

### 4. Accessibility audit (§13)
- axe on **every** screen in both themes, zero serious/critical.
- Manual screen-reader pass (VoiceOver iOS + macOS) through: onboarding, create reading (both sources),
  reading detail, journal search, journey, ask, paywall. Fix what is confusing, not just what is invalid.
- Keyboard-only pass through every flow; visible focus everywhere; no traps.
- 200% text scaling with no clipping or horizontal scroll; reduced-motion honoured throughout;
  contrast verified for all states including disabled and error.

### 5. Performance and cost (§13)
- Targets, measured and recorded: first meaningful paint on mid-range mobile 4G under 2.5s; journal list
  p95 under 300ms at 1000 readings; ask p95 recorded; interpretation first-token under 2s.
- Load test at realistic scale: 100 concurrent users, a 5000-reading user, 50k-object retrieval.
- Cost model: per-active-user and per-paying-user AI cost from `ai_calls`, with a documented ceiling and
  alerting; verify retrieval bounds hold at the 5000-reading scale.
- N+1 query audit on journal, journey and ask paths (query-count assertions in tests).

### 6. Complete eval suite
Consolidate every task's evals into one `pnpm eval` run with a summary report: schema validity, deck
purity, register/banned phrases, citation integrity, fabrication checks, extraction precision/recall,
correlation precision/recall, summary provenance. Commit baselines and document the human review process
for changing them.

### 7. Operations
- Runbooks: provider outage, cost spike, bad prompt rollback (version pin), failed migration, purge job
  failure, webhook backlog, key rotation.
- Migration safety: expand/contract discipline documented; a rollback rehearsal performed and recorded.
- Feature-flag rollout plan for the risky memory behaviours (`journey_autocreate`,
  `correlation_suggestions`, `ask_my_history`): percentage rollout, what to watch, kill criteria.
- Internal dashboards for the §16 metric set, built on `analytics_events` + `ai_calls`.

### 8. UX polish pass (§4, [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md))
Walk every screen against the design system as a checklist, not a vibe:
- All four states (skeleton / streaming / empty / error) designed and correct on every async surface.
- Every inferred element labeled, correctable and explainable.
- User text visually first-class and distinct from AI text everywhere.
- Copy read end to end for hedged register, no mysticism, no coercion, no hype.
- Transitions coherent; the shuffle reveal is the only flourish; everything skippable.
- One full pass at 390px and one at 320px; one desktop pass.
- Fix the ten worst rough edges you find and list them in the report.

### 9. Beta (§22)
- Seeded demo account per tester plus their own private account.
- In-app feedback affordance (content-free by default; the user chooses to attach an object reference).
- The §22 question set written into `docs/VALIDATION.md` with how each will be measured:
  can they log physical readings without frustration · do they understand Journey without explanation ·
  do they trust or reject suggested correlations · which evidence display feels credible · do
  revisit/outcome prompts feel useful or annoying · do they open Journey views voluntarily · would they
  pay for historical analysis specifically · do experienced readers feel supported rather than replaced.
- Go/no-go criterion stated plainly: **does accumulated history create increasing value and bring them
  back to old readings** — not whether they enjoyed an AI reading.

## Test plan

- [ ] Full suite green: `lint · typecheck · test · test:rls · build · test:e2e · eval`.
- [ ] `docs/ACCEPTANCE.md` shows every §19 criterion proven, with links.
- [ ] **All invariant tests unskipped and passing** — none remaining as placeholders.
- [ ] Security review findings triaged; every high/critical fixed and re-tested.
- [ ] RLS coverage test compares live schema tables against the suite and finds no gap.
- [ ] Delete-account purges everything (verified by querying every table for the user's ID afterwards,
      plus storage prefix listing).
- [ ] Export v2 opens correctly as Markdown and PDF and matches the JSON content.
- [ ] axe zero serious/critical on every screen, both themes; screen-reader and keyboard passes recorded.
- [ ] Performance and load targets met or explicitly documented as missed with a reason.
- [ ] Cost per active user computed and recorded.
- [ ] Runbooks written; one rollback rehearsed and recorded.

## Exit criteria

- [ ] Every §19 acceptance criterion proven.
- [ ] Security and privacy reviews complete with findings closed.
- [ ] Accessibility audit clean, including manual screen-reader passes.
- [ ] Performance, load and cost measured against stated targets.
- [ ] Full eval suite consolidated with committed baselines.
- [ ] Runbooks, rollout plan and dashboards in place.
- [ ] UX polish pass done; ten worst rough edges fixed and listed.
- [ ] Beta cohort onboardable; `docs/VALIDATION.md` written.
- [ ] Report + `../PROGRESS.md` marked beta-ready.
