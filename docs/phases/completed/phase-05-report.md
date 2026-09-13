# Phase 05 — Completion Report

**Status:** complete
**Date:** 2026-09-13
**Phase file:** [../phase-05-journal-search.md](../phase-05-journal-search.md)

---

## 1. What was built

The archive is now a real journal the user owns. `/journal` is a reverse-chronological timeline
grouped by month, cursor-paginated (keyset on `occurred_at, id` — never an offset), rendered from
stored rows through one `search_readings()` Postgres function with PostgREST embedding deck,
spread, cards and the current interpretation's synthesis: **no AI call anywhere on the route**
(the import-graph invariant now scans it). Search is FTS over a generated `search_vector`
(question + notes) with a pg_trgm word-similarity fallback for typos, plus card search resolved
through `card_aliases` so "strength" finds Thoth *Lust* and shows it under its own name; the
filters — date range, deck, spread, source, follow-up, notes, interpretation, sort — live in
the URL, compose, and clear in one link. Editing now covers spread and deck (a deck change
clears the cards with an honest notice; `replace_reading_cards` does cards + spread + deck in
one transaction and bumps `metadata_version`, so a stored interpretation shows as *stale*), and
every previous value of `user_notes` / `question` is kept in `reading_note_revisions` by a
database trigger — invariant 4 is a property of the data, shown on the detail page as *Earlier
versions*. Deletion is a soft delete (out of every view at once) followed by the `purge_deleted`
job, driven by the deletion registry, which hard-deletes every dependent artifact, verifies
zero rows remain and writes a `deletion_receipts` row with per-table counts; the confirmation
names exactly what goes. Export v1 is the `export_user_data` job: a zip of per-type JSON +
`links.json` + `manifest.json`, uploaded to a private `exports` bucket, delivered through a
10-minute signed URL from `/api/exports/[id]/download`, listed with status and expiry on
Profile, available on every plan. Profile also gained "Delete AI artifacts" (interpretations,
safety flags, question embeddings — keeps every word) and recent deletion receipts. The demo seed
gained long notes, a back-dated physical reading from 2023, two soft-deleted rows and a third
user, `demo-cleo`, with a generated 1000-reading journal. All four invariants for this phase
are unskipped and green.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Search is one `SECURITY INVOKER` Postgres function returning `setof readings`, embedded by PostgREST** | Text search, card matches, eight filters, three sorts and a keyset cursor compose in one planner-visible query; the trigram fallback (`<%`) cannot be expressed as a PostgREST filter at all; RLS still applies because the function runs as the caller. One round trip. | Hand-built PostgREST filter strings (no trigram, brittle `or=(…)` nesting); an offset-paginated list. |
| **Card ids for a text query are resolved by the caller with the pure `searchCards()` from Phase 02** (exact/prefix/alias hits only, never fuzzy) and passed to the function as `q_card_ids` | Reuses the deck-native alias search that already powers the picker, so the journal's "strength → Lust" behaviour is the same code as the picker's; fuzzy hits would turn ordinary words into card searches. Reference cards are memoised in-process for 5 minutes (global, immutable data). | A SQL join on `card_aliases` inside the function (a second implementation of the ranking). |
| **PostgREST cannot filter an embedded resource on an RPC result** (`interpretations.status=eq.complete` → `column pgrst_call.status does not exist`), so the embed selects `synthesis, status, superseded_by` and the current one is picked in `toItem()` | Found on the first render. A reading has a handful of interpretation rows at most. | A view; a second query. |
| **Note revisions are written by a `BEFORE UPDATE` trigger (`readings_keep_text`, SECURITY DEFINER), and the revisions table has no user insert/update policy** | Invariant 4 must hold whichever code path edits the row (proven by the integration test doing a raw service-role `update readings`). No policy means nothing can forge or rewrite history; the RLS test asserts both. Every change is kept, including each autosave pause — that is the honest cost of "nothing lost". | Application-level history in `updateReadingNotes` only. |
| **A question edit bumps `metadata_version` too** (same trigger) | The phase file names cards and deck; an interpretation quoting the old question is just as wrong, and the panel's *stale* notice already keys on the version. Phase 03's integration test expectations moved from 1→2 to 2→3. | Leaving question edits silent. |
| **Delete = soft delete as the user + enqueue `purge_deleted` + run that one job immediately** (`runBatch({ jobId })`), cron as the retry path | "Out of every view immediately" is the `deleted_at` update under RLS; "purge within minutes" becomes "usually within the same request" while keeping the job's retry and receipt semantics. Phase 03's custom-spread e2e (delete a reading, then delete its spread) depends on the purge having run. | Purge inline without a job (no retry, no sweep); waiting for cron (the spread stays "in use" for minutes). |
| **The purge is driven by the registry's `reading` root and refuses a reading that was not soft-deleted** | Counts every registered table before, runs explicit removers for `via: 'job'` targets, verifies zero after; a registry table without a counter fails a unit test, and a `reading_id` FK missing from the registry fails it too. The user's delete is the only entry point. | A hand-written delete list that drifts from the registry. |
| **Fresh jobs no longer stamp `run_after` from the JS clock; an explicitly named job is claimed regardless of `run_after`** | The Docker DB clock runs ~10 ms behind the host, so `run_after = new Date()` was occasionally "in the future" for the claim a few ms later — two purges in a full e2e run stayed `queued`. Same family as Phase 04's `PGRST303` note. | Sleeping before the claim. |
| **`exports` is request-own (queued rows only), read-own; the job reads the user id from the row** | A user can ask and can see; only the service role attaches an archive. The job payload carries the export id, so a wrong `userId` on the job (tested) cannot export someone else. | Passing the user id in the payload. |
| **Archives are delivered by a route that 302s to a 10-minute signed URL; the bucket has no `storage.objects` policies** | Ownership is checked through the user client (RLS) before minting; the URL expires and is not guessable (both tested against local storage). A plain `<a download>` works for the browser and Playwright. | A server action returning a URL (awkward to download); public bucket with obscure names. |
| **`removeUserStorage()` from `STORAGE_PREFIXES`** | Rows cascade from `auth.users`; bytes do not (found by a spot-check: 25 orphaned archives from tests). The test harness now calls it on user deletion; Phase 12's account job must too. | Leaving it to Phase 12 undiscovered. |
| **Virtualisation is `content-visibility: auto` + cursor pages, not a windowing library** | SSR-friendly, variable heights, no third-party dependency; measured 16.7 ms p50 / 16.8 ms p95 per frame scrolling 1000 entries on the mobile profile. | `react-virtual`-style windowing (breaks SSR, anchors, find-in-page). |
| **The filter form is a plain GET form whose submit is turned into a clean client navigation** | Every control has a name, so the URL is the state and the form works without JavaScript; `next/form` put every empty field in the URL, so the submit handler parses the form and pushes `journalHref()` — only non-default values. | `next/form`; client state synced to the URL by effect. |
| **Month headings group in UTC on the server and regroup in the viewer's zone after mount** | Same pattern as `LocalTime`; `profiles.timezone` is still `UTC` for everyone. | Server grouping only (wrong around midnight). |
| **Export excludes soft-deleted readings and `ai_calls`; includes every interpretation generation, the user's feedback words, safety flag categories, question-ask hashes (no vectors)** | The user deleted them; telemetry is not theirs; derived artifacts are theirs (§9.4) with their versions; vectors are useless outside the app and 1536 floats per ask. | Exporting vectors; exporting deleted rows "for safety". |
| **Zip via `fflate`** (new dependency) | 8 kB, sync, no native code, and its `unzipSync` lets the round-trip tests read the archive back. | A hand-rolled zip writer. |
| **Delete AI artifacts is synchronous, as the user** | The three tables have owner delete policies; the receipt is written by the service role afterwards. Immediate feedback, RLS-scoped by construction. | A job (adds latency, no benefit). |

## 3. Files and modules

```
src/domain/
  journal/filters.ts ★             JournalFilters + Zod, parseJournalParams / toSearchParams / journalHref, cursor encode/decode, groupByMonth, dayRangeToInstants
  export/schema.ts ★               export/1.0.0 contract: manifest + per-file Zod schemas, link kinds, validateExport()
  privacy/deletionRegistry.ts      + reading_note_revisions, deletion_receipts, exports; STORAGE_PREFIXES

src/db/
  schema/readings.ts               + search_vector (generated tsvector), timeline/updated keysets, GIN FTS + trigram indexes
  schema/journal.ts ★              reading_note_revisions, deletion_receipts, exports (+ policies, checks)
  migrations/0006_journal.sql ★    generated DDL + readings_keep_text trigger, search_readings(), replace_reading_cards(5 args), exports bucket, comments
  queries/journal.ts ★             searchJournal (RPC + embed → JournalItem, cursor), resolveQueryCardIds, countReadings
  queries/readings.ts              replaceReadingCards(+ spread/deck/reversals), softDeleteReading, listNoteRevisions, countReadingDependents; recent cards exclude deleted
  queries/exports.ts               requestExport / listExports / getExport / hasPendingExport, listDeletionReceipts, EXPORT_COOLDOWN_MS
  admin/index.ts                   insertDeletionReceipt, exportStoragePath, uploadExportArchive, createExportSignedUrl, removeExportArchives, removeUserStorage

src/privacy/ ★
  purge.ts                         purgeReading() driven by the registry (count → job removers → delete → verify → receipt), purgeSoftDeletedReadings()
  aiArtifacts.ts                   countAiArtifacts / deleteAiArtifacts (as the user) + receipt
src/export/build.ts ★              buildExportArchive(userId): every file, links, manifest, zip
src/jobs/
  handlers/purge-deleted.ts        purge_deleted {readingId | null (sweep)}
  handlers/export-user-data.ts     export_user_data {exportId}: running → build → upload → ready (7-day expiry) / failed; sweeps expired
  worker.ts                        runBatch({ jobId }) claims one named job regardless of run_after; enqueue.ts lets the DB stamp run_after

app/(app)/
  journal/page.tsx ★               parse URL → searchJournal + decks/spreads/count → filters + list; empty state
  journal/filters.tsx ★            GET form (search, Filters disclosure, selects apply on change, Clear all) → clean client navigation
  journal/journal-list.tsx ★       month groups (viewer zone), polite status count, sentinel + Load more, dedupe
  journal/actions.ts               loadJournalPageAction (cursor page)
  reading/[id]/edit/page.tsx, edit-form.tsx ★  deck + spread selects, reversals checkbox, honest notice, structure diff on save
  reading/[id]/controls.tsx        describeDeletion(), ReadingControls (Delete names what goes; Export → Profile; Share → Phase 11)
  reading/[id]/page.tsx            + revisions (NoteHistory slot) + dependents for the delete copy
  reading/actions.ts               updateReadingAction(structure), deleteReadingAction (soft delete → purge job → run now → Home)
  profile/page.tsx                 export history, delete AI artifacts (real), receipts
  profile/privacy-controls.tsx ★   ExportControls (polls while in flight), DeleteAiArtifactsControl, DeletionReceipts
  profile/actions.ts               requestExportAction (one at a time, 15-min cooldown, runs the job now), deleteAiArtifactsAction
app/api/exports/[id]/download/route.ts ★  RLS-checked read → 302 to a 10-min signed URL
app/dev/ui/deck-gallery.tsx        + TimelineItem (both decks) and NoteHistory sections

src/ui/components/
  timeline-item.tsx ★              the journal row (content-visibility: auto, AI/note preview, chips, matched-card highlight), previewText
  note-history.tsx                 Earlier versions <details>
  reading-detail.tsx               `history` slot

scripts/
  seed-demo-readings.ts            LONG_NOTE, back-dated + soft-deleted stories, seedBulkReadings(userId, n, seed)
  seed-demo.ts                     demo-cleo + `--bulk N` (default 1000)

Tests (§7): src/domain/journal/__tests__/filters.test.ts, src/domain/export/__tests__/schema.test.ts,
  src/privacy/__tests__/copy.test.ts, src/db/queries/__tests__/{journal,journal-perf}.integration.test.ts,
  src/export/__tests__/export.integration.test.ts, src/db/__tests__/journal.rls.test.ts,
  src/__tests__/invariants/{deleting-reading-purges-derived,raw-text-never-overwritten,archive-readable-without-subscription}.{test,integration.test}.ts,
  src/__tests__/fixtures/journal-db.ts, e2e/journal.spec.ts, e2e/_helpers.ts (seedReadings, signInAsDemo)
```

## 4. Database changes

`0006_journal.sql` (`drizzle-kit generate --name journal`, then hand-written after the marker):

- `readings`: `search_vector tsvector generated always as (to_tsvector('english', coalesce(question,'') || ' ' || coalesce(user_notes,''))) stored`; indexes `readings_user_timeline_idx (user_id, occurred_at desc, id desc) where deleted_at is null`, `readings_user_updated_idx (user_id, updated_at desc, id desc) where deleted_at is null`, `readings_search_idx` GIN, `readings_question_trgm_idx` / `readings_notes_trgm_idx` GIN `gin_trgm_ops`.
- `reading_note_revisions` (7 columns; check `field in ('user_notes','question')`; FKs `reading_id` cascade, `user_id` cascade; indexes `(reading_id, replaced_at desc)`, `(user_id, replaced_at desc)`; policies **select + delete only**).
- `deletion_receipts` (9 columns; check on `scope`; `user_id` FK **on delete set null**; index `(user_id, completed_at desc)`; policy **select only**).
- `exports` (12 columns; checks on `status` and `format`; `user_id` cascade; index `(user_id, requested_at desc)`; policies select + **constrained insert** (`user_id = auth.uid() and status = 'queued' and storage_path is null and job_id is null`)).
- Hand-written: `readings_keep_text()` + trigger `BEFORE UPDATE OF user_notes, question, is_open_reflection` (SECURITY DEFINER, `REVOKE … FROM public`); `search_readings(jsonb) returns setof readings` (STABLE, INVOKER, `search_path = public, extensions`, `pg_trgm.word_similarity_threshold = 0.5`; granted to `authenticated, service_role`); `DROP FUNCTION replace_reading_cards(uuid, jsonb)` + the 5-argument version (refuses soft-deleted readings; updates spread/deck/reversals before re-inserting cards so the existing triggers validate against the new deck); `insert into storage.buckets ('exports', private, 100 MB, application/zip)`; comments.

DATA_MODEL.md updated (readings section, the three tables, functions, RLS variants). Deletion
registry as built is in PRIVACY_AND_DELETION.md. Later phases: Phase 06's extractions join
`deleteAiArtifacts` and the export; Phase 08's confirmed links go into `links.json`; Phase 12's
account deletion must call `removeUserStorage()`.

## 5. AI tasks touched

None. No file reachable from `app/(app)/journal`, `app/(app)/profile`, `app/api/exports`,
`src/export/`, `src/privacy/` or `src/jobs/handlers/` imports `src/ai/` (asserted by the
extended `opening-reading-makes-no-ai-call` scan); the e2e journal spec proves `ai_calls` does
not move for its user across search, filter, edit, delete and export.

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `JOURNAL_PAGE_SIZE` | `domain/journal/filters.ts` | 30 | 34 pages for 1000 readings; each page 6–19 ms (perf test) |
| `QUERY_MAX` | same | 200 chars | a search box, not an essay |
| `pg_trgm.word_similarity_threshold` | `search_readings` | 0.5 | "pentacels" → "pentacles" matches; "money" does not match unrelated notes (integration test) |
| Card-search hit threshold | `queries/journal.ts` | `matched !== 'fuzzy' && score >= 50` | exact/prefix/alias only; "money" finds no card |
| `CARDS_MEMO_MS` | same | 5 min | reference data is global and immutable between deploys |
| `EXPORT_TTL_MS` | `jobs/handlers/export-user-data.ts` | 7 days | archive lifetime; swept on the user's next export |
| `SIGNED_URL_SECONDS` | download route | 600 | one download, not a permalink |
| `EXPORT_COOLDOWN_MS` | `queries/exports.ts` | 15 min | one archive at a time; never refuses the data, only re-spending |
| `TIMELINE_THUMBS` / `PREVIEW_CHARS` | `timeline-item.tsx` | 5 / 140 | fits 390 px with the Celtic cross as "+5" |
| IntersectionObserver `rootMargin` | `journal-list.tsx` | 600 px | next page arrives before the sentinel is seen |

ALGORITHMS.md gained §7 (journal search).

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/journal/__tests__/filters.test.ts` (6) | every URL key parses and round-trips; a bad value drops only itself; bare URL = everything; sort alone is not "active"; inverted range swapped; arrays take the first value; cursor round-trips and rejects garbage; month grouping per zone; local-day ranges in Berlin/New York |
| unit | `domain/export/__tests__/schema.test.ts` (3), `privacy/__tests__/copy.test.ts` (2) | contract accepts a minimal archive; reports missing file / malformed row / count mismatch by name; refuses a foreign version; deletion copy names cards, notes, history, interpretations; preview truncation |
| unit (invariant) | `deleting-reading-purges-derived.test.ts` (3), `raw-text-never-overwritten.test.ts` (3), `archive-readable-without-subscription.test.ts` (2) | see below |
| unit (invariant, extended) | `opening-reading-makes-no-ai-call.test.tsx` (+1) | import graph now covers journal, profile, export route, jobs, purge, export builder; `searchJournal` against a fake is one RPC and no table read, picks the current synthesis, and `TimelineItem` renders a Thoth row with no RWS vocabulary while the AI spy is never called |
| unit (invariant, extended) | `thoth-never-substitutes-rws.test.tsx` | `journal.ts` and the revisions read are in the allowed-tables scan |
| unit | `db/__tests__/deletion-registry.test.ts` (updated) | the three new tables are covered; the ghost-table detector still fires |
| integration | `db/queries/__tests__/journal.integration.test.ts` (22) | newest-first rows with every timeline column, soft-deleted rows absent from list/count/search; FTS on question and notes, quoted phrase, **typo via trigram**, no false hits; **alias search finds RWS Strength and Thoth Lust, the Thoth hit is named Lust and carries no RWS word**; 14 table-driven filter combinations; spread filter; three sorts; **keyset pagination stable while a row is inserted between pages**, garbage cursor starts from the top; date range in Kiritimati vs UTC; a deleted reading's words are gone from search while its derived rows wait for the purge |
| integration | `db/queries/__tests__/journal-perf.integration.test.ts` (8) | 1000 generated readings: p95 < 300 ms for the timeline, text, card, typo, composed filters, has-interpretation, edited sort; paging through all 1000 stays flat |
| integration | `export/__tests__/export.integration.test.ts` (3) | job → `ready` row with path/size/expiry/job id; signed download; archive validates; every reading, card, revision, both interpretation generations (with `supersedes`), safety flag, deck-native card names, links present with database ids; deleted reading and `ai_calls` absent; **manifest counts equal the database**; signed URL expires after 1 s and a tampered token fails; the user's JWT cannot download or list the bucket; `removeUserStorage` removes the bytes; **a job with the wrong `userId` still exports the row's owner** and the other user cannot see the row |
| integration (invariant) | `deleting-reading-purges-derived.integration.test.ts` (2), `raw-text-never-overwritten.integration.test.ts` (3), `archive-readable-without-subscription.integration.test.ts` (1) | see below |
| integration | `db/queries/__tests__/readings.integration.test.ts` (updated) | soft delete hides at once, keeps cards for the purge, twice is a no-op; recent cards exclude deleted readings; question edit bumps the version |
| rls | `db/__tests__/journal.rls.test.ts` (5) | revisions: trigger-written, B/anon read nothing, A cannot forge or edit, B cannot delete, A can delete; `deletion_receipts` read-own/service-write; `exports`: A requests only a queued row without path/job, B cannot spoof, A cannot update or delete, B/anon read nothing; `search_readings` returns only the caller's rows, anon none; `replace_reading_cards` with deck/spread on A's reading as B → `P0002`, anon refused |
| e2e | `e2e/journal.spec.ts` (5 × 2) | **search "strength" across decks** (Thoth row says Lust, never Strength/Pentacles), typo search on notes, deck + date filters in the URL, restorable on reload, Clear all, `ai_calls` unchanged for the user; **open → edit: deck to Thoth clears cards with the notice, Save disabled until re-entered, saved reading shows Thoth / The Universe, notes untouched**; **Delete dialog names "its 1 card and your notes", Tab stays inside the dialog, Escape cancels, confirm → Home, gone from journal, 404 on the URL, receipt on Profile**; **Export → Ready with size → Download → zip parsed: manifest `export/1.0.0`, 3 readings with the seeded ids, Lust in cards.json; second request declined politely**; keyboard-only search, Filters disclosure, deck select → URL, "No readings match." + empty state, sort → URL, live region `aria-live="polite"`; **demo-cleo: 1000 items loaded, `content-visibility: auto`, frame times while scrolling recorded** — axe on every screen |
| e2e | `e2e/reading.spec.ts` (updated) | the per-card `<details>` locator is scoped to *Cards in position* (the note history now precedes it) |

Invariant tests unskipped this phase:
- [x] `deleting-reading-purges-derived.test.ts` — the purge job has a counter for every registry
      target and a remover for every `via: 'job'` one; every table with a `reading_id` FK in the
      migrations is registered; delete is `softDeleteReading` + `purge_deleted`, no hard delete
      in the query layer, every `readings` select filters `deleted_at`, the search function and
      export do too. **Integration:** a reading with 3 cards, 2 revisions, 1 interpretation, 1
      flag and 1 linked ask is soft-deleted (gone from get/list/search at once), the purge
      refuses until then, the job runs, zero rows remain in every registry table, the receipt
      records `{reading_cards: 3, interpretations: 1, question_embeddings: 1, safety_flags: 1,
      reading_note_revisions: 2, readings: 1}`, the other reading is untouched, purging again is
      a no-op, the sweep purges a reading whose immediate purge never ran.
- [x] `raw-text-never-overwritten.test.ts` — no module under `src/ai`, `src/interpretation`,
      `src/jobs`, `src/privacy`, `src/export` writes `readings` or `reading_cards`; every
      `modelWrite()` payload is free of user-text columns; the trigger and the select+delete-only
      policies are in the migration; notes are stored trimmed, never transformed.
      **Integration:** three edits keep three versions and the current text, same text again
      writes nothing, a question edit is kept and bumps the version, a raw service-role update
      still leaves history, clearing keeps the last text, derived artifacts leave the reading
      byte-identical, revisions cannot be edited or forged.
- [x] `archive-readable-without-subscription.test.ts` — no journal, detail, search, export or
      delete path references the plan, a subscription, a budget or a paywall (comments and the
      "on any plan" copy stripped; the panel's `budget_denied` failure copy for a *new*
      generation is the one exemption). **Integration:** `plan = 'free'`, consent withdrawn →
      list, search (with the stored synthesis), detail, history, export request and archive all
      work. Phase 11 must extend it to exhausted limits.
- [x] `opening-reading-makes-no-ai-call.test.tsx` — extended to the journal (above).

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  39 passed | 5 skipped (44)
      Tests  263 passed | 5 skipped (268)          (unit, 5.7 s)
 Test Files  13 passed (13)
      Tests  85 passed (85)                        (integration, 25.9 s)

$ pnpm test:rls
 Test Files  8 passed (8)
      Tests  24 passed (24)                        (7.8 s)

$ pnpm build && pnpm check:client-bundle && pnpm check:prompt-versions
 ✓ Compiled successfully in 4.8s
├ ƒ /api/exports/[id]/download 167 B · /journal 16.2 kB (233 kB) · /profile 4.73 kB (222 kB)
├ ƒ /reading/[id] 10.8 kB (164 kB) · /reading/[id]/edit 4.85 kB (152 kB)
check-client-bundle: ok (64 files scanned)
check-prompt-versions: ok (0 task dir(s) touched)

$ pnpm test:e2e            (mobile 390×844 + desktop)
  110 passed (1.8m)   — seven full runs after the last code change: 110/110 ×6; one run
  printed "109 passed" as its last line with the line above not captured (no failure line);
  the four runs after it were 110/110

$ pnpm db:migrate
migrations applied
$ curl localhost:3000/api/health
{"status":"ok","db":true,"migration":{"current":true,"expected":"0006_journal",...},"provider":{"provider":"mock",...}}

$ pnpm demo:seed
  44 readings across 3 users (6 months)   (Ana 24 incl. 2 soft-deleted + 1 back-dated 2023, Ben 20)
  24 interpretations for consenting demo users
  1000 generated readings for demo-cleo@tarot.local
demo seed complete                          (2.0 s wall clock)
```

Deletion-registry completeness gate, verified by removing `reading_note_revisions` from the
registry and restoring it:
```
$ pnpm tsx scripts/check-deletion-registry.ts
Deletion registry is missing user-owned table(s): reading_note_revisions
Register each in src/domain/privacy/deletionRegistry.ts.        exit=1
$ vitest deletion-registry.test.ts
 × covers every user-owned table in the schema
 × reads Drizzle tables structurally                            2 failed | 1 passed
(restored) check-deletion-registry: ok
```

Database spot-check (psql in the Supabase container, after the gates):
```
 policies: reading_note_revisions 2 (select, delete) · deletion_receipts 1 (select) · exports 2 (select, insert)
 functions: search_readings (prosecdef f) · replace_reading_cards (f) · readings_keep_text (t)
 triggers on readings: readings_set_updated_at, readings_check_deck, readings_keep_text
 indexes on readings: … readings_search_idx (gin), readings_question_trgm_idx, readings_notes_trgm_idx, readings_user_timeline_idx, readings_user_updated_idx
 storage.buckets: exports | public f | {application/zip}
 receipts: reading 33 · exports: ready 19 · revisions: user_notes 13, question 1 · soft-deleted rows awaiting purge: 2 (demo seed)
 DB now() vs host date: identical to the second; a ~10 ms skew showed up as two queued purges before the worker fix
```

| Metric | Target | Measured (1000 readings, PostgREST end to end, 40 runs each) |
|---|---|---|
| Timeline first page | p95 < 300 ms | p50 11.1 · **p95 18.9 ms** |
| Text search "manager" | p95 < 300 ms | p50 31.8 · **p95 35.3 ms** |
| Card search "tower" (aliases, both decks) | p95 < 300 ms | p50 63.8 · **p95 68.0 ms** |
| Typo "conversaton" (trigram) | p95 < 300 ms | p50 32.4 · **p95 35.0 ms** |
| deck + date + has notes | p95 < 300 ms | p50 13.4 · **p95 15.3 ms** |
| has-interpretation = false + resolved | p95 < 300 ms | p50 10.1 · **p95 13.2 ms** |
| Recently edited sort | p95 < 300 ms | p50 10.7 · **p95 14.1 ms** |
| Paging through all 1000 (34 pages) | flat | first 11.3 · last 6.3 · p95 13.5 ms |
| Scrolling 1000 entries, mobile profile (466 frames) | 60 fps | **p50 16.7 ms · p95 16.8 ms · 7 frames > 50 ms (1.5 %)** |
| Scrolling 1000 entries, desktop (444 frames) | 60 fps | p50 16.7 · p95 16.8 ms · 10 long (2.3 %) |
| Model calls across search / filter / edit / delete / export (e2e user) | 0 | 0 |
| Bulk seed of 1000 readings + 3 000 cards | — | ~1 s |
| Unit / integration / RLS / e2e | fast | 5.7 s / 25.9 s / 7.8 s / ~105 s |

Manual checks actually performed:
- [x] **390 px screenshots, light + dark**: journal (Ana, both deck accents, AI preview vs note
      preview, chips), search "strength" as Ben (Thoth *Nine of Wands* — titled Strength — found
      and highlighted under its own name), filters panel, "Nothing matches", empty journal for a
      fresh user, Profile with export history + Download + receipts, the delete dialog naming "its
      3 cards and 1 AI interpretation", the edit form after a deck switch (cleared cards, notice,
      Thoth picker), a reading with *Earlier versions* open, `/dev/ui` with the new sections.
      Fixed from this review: `next/form` writing every empty field into the URL; the "Preparing
      your export" notice lingering after the archive was ready.
- [x] **Downloaded an archive** through `/api/exports/[id]/download` → 302 → storage: 12 files,
      manifest counts 22 readings / 22 interpretations / 50 cards / 124 links for demo-ana, the
      two soft-deleted readings absent.
- [x] **Keyboard**: search → Enter, Tab to *Filters* → Enter, Tab to the deck select, sort select;
      the delete dialog traps Tab and closes on Escape (all in `journal.spec.ts`).
- [x] **Screen reader**: `#journal-summary` is `role="status" aria-live="polite"` and announces
      "N readings match." / "No readings match."; every filter control is a labelled native
      element; month headings are `<h2>` in labelled sections.
- [x] **Registry completeness gate** fails when a table is removed (above).
- [x] **Soft-deleted rows** never appear in the journal, home, search, recent cards, export or
      the detail page (404), while their derived rows wait for the purge (integration + e2e).

## 9. UX notes

States: the journal's **empty** state teaches the next action ("Your readings will collect here.
The first one is the start of your timeline." + *Start a reading*); **no results** says what to
try (fewer filters, a card name — aliases work across decks — a word from a note); the list's
**loading** is the *Load more* button's "Loading…" with the sentinel doing the work; **error** on
a failed page load is an inline message with the button still there. Export shows *Preparing…*
on the button, polls every 2 s while in flight, then *Ready · 24 KB · Link available until …*
with *Download*; a failed job reads *Did not complete*. Delete AI artifacts quotes the counts
before the destructive verb and confirms "Removed N generated items. Your words are untouched."
The edit form's structural change notice is a `role="status"` region.

Design system extended with `TimelineItem`, `NoteHistory`, `JournalFilters`, `JournalList`,
`ExportControls`, `DeleteAiArtifactsControl`, `DeletionReceipts` (DESIGN_SYSTEM.md updated);
`TimelineItem` and `NoteHistory` are in the `/dev/ui` gallery.

Rough edges left deliberately: the "Reversed" chip on `xs` thumbnails overhangs the card (the
Phase 02 `Card` treatment at its smallest size); the filter panel is a plain stacked form at
390 px (one column) and does not collapse after a select applies; month headings are sticky but
plain; the edit form's picker focus ring uses the page-level accent for a beat before the
form's `data-deck` takes over; the *Recently edited* sort counts a follow-up tap or a revisit
date as an edit (`updated_at`); the "outcome recorded later" chip waits for Phase 08.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Entity / journey filters | Objects do not exist yet | 06 / 07 (phase file) |
| Markdown / PDF export | v2 by design | 12 |
| Extractions and summaries in "Delete AI artifacts" and in the export | Tables land in 06 / 10; both functions are one list away | 06, 10 |
| Confirmed links in `links.json` | Phase 08 objects; `LINK_KINDS` is the place | 08 |
| Account-deletion storage sweep | `removeUserStorage()` exists and is tested; the account job is Phase 12 | 12 |
| A digital reading's `rng.deck_id` after a deck change in edit | The draw record stays as the audit of the original draw; the cards no longer replay from it once edited (true since Phase 03 for card edits). The detail page does not surface `rng` yet | when `rng` is surfaced (12) |
| Revision coalescing (one row per autosave pause) | Every change kept is the honest reading of invariant 4; storage cost is small text | revisit if history grows noisy |
| `search_readings` relevance ordering | Journal results keep the chosen time order by design; a rank-ordered mode is a UX question | if asked |
| Purging e2e users' export archives locally | `createReadyUser` users are never deleted (Phase 01 deferral); their archives accumulate in the local bucket | 12 (with the user purge) |

## 11. Known issues and risks

- **Clock skew between the Docker database and the host** (~10 ms) bit twice: Phase 04's
  `PGRST303` and this phase's queued-but-not-claimed purge. Jobs now let the DB stamp
  `run_after` and a named job is claimed regardless; anything else that compares a JS `Date` to
  DB `now()` should assume a few ms of drift.
- **Every note autosave pause writes a revision.** Fine for 5 000-char notes; a very long
  editing session produces many rows. Coalescing is a one-line trigger change if needed.
- **`content-visibility: auto`** is supported by Chromium, Firefox 125+ and Safari 18+; older
  browsers simply render every item (still correct, just heavier). Find-in-page works because
  hidden items keep their DOM.
- **Card search noise:** a query that is both a word and a card ("star", "sun", "world") matches
  readings containing that card *and* readings mentioning the word — intended (both are what a
  person would expect), but a Thoth reader searching "world" will see *The Universe* rows.
- The export `email` comes from `auth.admin.getUserById` inside the job; a transient auth API
  failure fails the job (retried by the worker) rather than exporting without it.
- One full e2e run ended with "109 passed" and no failure line captured (six other runs
  110/110). If it recurs, look at the Phase 03 custom-spread test and the interpretation stream
  under 8 workers, the two that have shown load sensitivity before.
- `demo:seed` regenerates demo-cleo's 1000 readings on every run (~1 s); the two soft-deleted
  demo rows stay soft-deleted until a purge sweep runs (`purge_deleted {readingId: null}` — no
  script enqueues it yet; the cron batch only runs queued jobs).

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Sign in as `demo-ana@tarot.local` / `demo-password-123` → Journal: 22 readings by month
   (two soft-deleted rows never show). Search `strength` → RWS *Strength* readings; sign in as
   `demo-ben@tarot.local` and search the same → Thoth rows highlight *Nine of Wands* (titled
   Strength) and never say Strength. Search `pentacels` → the typo finds the note. Open
   *Filters*, pick a deck and a date: the URL carries them; reload keeps them; *Clear all*.
2. Open a reading → *Your interpretation*: edit the note twice → *Earlier versions (2)* lists
   both. Edit → change the deck → the cards clear with a notice → enter one card → Save: the
   detail shows the new deck and, for Ana's interpreted readings, the *stale* notice.
3. Delete a reading: the dialog names its cards, notes, versions and interpretations → confirm →
   Home; the journal no longer lists it; Profile → *Recent deletions* shows "A reading · N rows
   purged" within a second. `select * from deletion_receipts order by completed_at desc limit 1`.
4. Profile → *Export* → *Ready · N KB* → *Download* → unzip: `manifest.json` counts match
   `readings.json` etc.; `interpretations.json` has every generation with versions.
5. Profile → *Delete AI artifacts* (Ana): the dialog quotes the counts → confirm → journal
   previews fall back to notes; the readings are untouched.
6. Sign in as `demo-cleo@tarot.local`: 1000 readings; scroll — smooth; the summary reads
   "1000 readings." once every page is in.

## 13. Notes for the next phase

- **Journal query surface:** `searchJournal(client, filters, { cursor, limit, timeZone })` →
  `{ items, nextCursor, matchedCardIds }`; `JournalItem` is the list's contract. Entity and
  journey filters (06/07) are new keys in `journalFiltersSchema` + `URL_KEYS`, a new parameter
  in `search_readings(p)` (an `EXISTS` on the new join table), and a select in `filters.tsx` —
  the URL, cursor and list need nothing else.
- **Deletion registry is executable now:** register a new `reading`-root table and add a
  counter in `src/privacy/purge.ts` (`READING_DEPENDENT_COUNTERS`) or the unit invariant fails;
  `via: 'job'` targets also need a remover. `life_event` / `journey` / `entity` roots are empty
  and need the same pattern when their tables land.
- **Export:** add a file name to `EXPORT_FILES`, a schema to `EXPORT_FILE_SCHEMAS`, a collector
  in `buildExportArchive()` and a `LINK_KINDS` entry; bump `EXPORT_SCHEMA_VERSION` when the
  shape of an existing file changes. The round-trip test validates every file.
- **Delete AI artifacts:** `AI_ARTIFACT_TABLES` in `src/privacy/aiArtifacts.ts` — add
  `extractions` etc. (each needs an owner delete policy).
- **Invariant 4 is a trigger:** `readings_keep_text` records `user_notes` and `question`;
  `reading_cards.user_meaning` is not written by anything yet — extend the trigger when it is.
  Derived-side modules (`src/ai`, `src/interpretation`, `src/jobs`, `src/privacy`, `src/export`)
  must never write `readings` / `reading_cards`; the unit invariant scans for it.
- **Jobs:** `enqueue()` then `runBatch({ jobId })` is the pattern for "do it now, cron retries";
  never compare a JS `Date` with DB `now()` for claiming.
- **Fixtures:** `src/__tests__/fixtures/journal-db.ts` (`makeReading`, `storeInterpretation`,
  `attachDerived`) and `e2e/_helpers.ts` `seedReadings()` create realistic data fast; the e2e
  AI-call spy must be scoped to the test's `user_id`.
- `metadata_version` now moves on question edits too; anything keyed on it (extractions in 06)
  inherits "stale on question change" for free.
- These notes were added to the Phase 06 file.
