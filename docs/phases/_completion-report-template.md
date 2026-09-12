# Phase NN — Completion Report

Copy this file to `completed/phase-NN-report.md` and fill every section. (The relative links below
are written for that location — they resolve once the file is in `completed/`.) A future session will rely on
this instead of re-reading the code, so write it for someone with no memory of this work.

**Status:** complete / complete-with-deferrals
**Date:** YYYY-MM-DD
**Phase file:** [../phase-NN-name.md](../phase-NN-name.md)

---

## 1. What was built

Prose, 3–10 sentences. What exists now that did not before, in product terms, and the shape of the
implementation. Enough that someone can predict where things live before opening the tree.

## 2. Decisions made

Anything a future session must not accidentally undo, and the reasoning. Include decisions that
*differed* from the phase file, and why the phase file was wrong.

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| | | |

## 3. Files and modules

Grouped by area, with a one-line purpose each. Mark the files that matter most with **★**.

```
src/domain/...
src/db/migrations/...
app/(app)/...
```

## 4. Database changes

Migrations added (file names), tables/columns/enums/indexes created or altered, RLS policies added.
Note anything that later phases must extend. If [../../DATA_MODEL.md](../../DATA_MODEL.md) drifted from
reality, say so and update it in the same session.

## 5. AI tasks touched

| Task | Prompt ver | Schema ver | Model tier | Notes |
|---|---|---|---|---|

Plus: prompt iterations that mattered, what made output worse, eval numbers before/after.

## 6. Thresholds and constants

Any value in a `thresholds.ts` that was set or changed, its current value, and the evidence for it.
Update [../../ALGORITHMS.md](../../ALGORITHMS.md) to match.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|

Invariant tests unskipped this phase:
- [ ] `name.test.ts` — what it asserts

## 8. Verification evidence

Paste the real output. Not "all tests pass".

```
$ pnpm lint && pnpm typecheck
...
$ pnpm test
... N passed
$ pnpm test:rls
... N passed
$ pnpm test:e2e
... N passed
```

Measurements this phase was required to record (latency, timings, precision, cost, token counts):

| Metric | Target | Measured |
|---|---|---|

Manual checks actually performed, with observed results (including at 390px and keyboard-only):
- [ ] …

## 9. UX notes

What was built for the four states (skeleton/streaming/empty/error). Where the design system was
extended. Anything that currently feels rough and why it was left.

## 10. Deferred / not done

Anything in the phase file not implemented, with the reason and the phase it moves to. Be explicit —
a silent omission here becomes a bug three phases later.

| Item | Reason | Moved to |
|---|---|---|

## 11. Known issues and risks

Bugs, flaky tests, fragile assumptions, performance concerns, prompt quality concerns.

## 12. How to verify this phase from scratch

Exact commands and click-path a new session can run to confirm the phase still works:

```bash
pnpm supabase:start && pnpm db:migrate && pnpm db:seed && pnpm demo:seed && pnpm dev
```
1. …

## 13. Notes for the next phase

What the next session should know, watch out for, or reuse. Anything you learned that the next phase
file does not yet say — **and then go edit that phase file to say it.**
