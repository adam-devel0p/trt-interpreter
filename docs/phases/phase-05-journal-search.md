# Phase 05 — Journal, Search, Edit & Export v1

**Deps:** 04 · **Spec:** §6.3, FR-07, FR-21, FR-22, FR-23, §13, §19 · **Outcome:** the archive becomes
a real, fast, searchable journal the user owns — browse, filter, search, edit, delete for real, and
export everything — with no AI call anywhere in the browsing path.

> After this phase the product is independently useful and shippable as a private tarot journal. That
> is a deliberate checkpoint.

## Scope

**In:** journal timeline, filters, full-text + card/date/spread search, reading editing, soft-delete +
purge job, deletion registry v1, JSON export, Profile export/delete UI.

**Out:** entity/journey filters (added in 06/07 once those objects exist), Markdown/PDF export (12).

## Tasks

### 1. Journal timeline (FR-07)
- Reverse-chronological list grouped by month, virtualised, paginated (cursor-based, never offset).
- Each item: date, question (or "Open reflection"), deck accent, spread name, card thumbnails/names,
  a one-line preview of the synthesis **or** the user's note if there is no interpretation, and status
  chips (unresolved, has revisit date, outcome recorded later).
- **Zero AI calls** — the list renders from stored rows only (§13 performance).
- Empty state teaches the next action in one sentence (§DESIGN_SYSTEM loading/empty states).

### 2. Search & filters (FR-21)
- Postgres FTS over `question + user_notes`, with a generated `tsvector` column and GIN index; trigram
  fallback for short/typo queries.
- Card search resolves through `card_aliases`, so cross-deck terms work and results show each card's
  **actual** deck-native name (FR-03C).
- Filters: date range, deck, spread, source (digital/physical), follow-up status, has-notes,
  has-interpretation. Filters compose, are reflected in the URL (shareable/restorable), and clear in
  one tap.
- Sort: newest, oldest, recently edited.
- Performance target: p95 under 300ms at 1000 readings (measured against demo seed, recorded in report).

### 3. Reading edit (§6.3 controls)
- Edit question, `occurred_at`, spread, deck, cards and orientations, plus notes (already inline).
- **Raw user text is never destroyed:** editing notes keeps a `reading_note_revisions` history (append
  new table) so nothing the user wrote is lost (invariant 4).
- Changing cards or deck marks the interpretation `stale` with an honest label and an optional
  regenerate — it does **not** silently regenerate or silently keep a now-wrong interpretation.

### 4. Deletion (FR-23, §19)
- Soft delete removes the reading from every view and every future retrieval path immediately.
- `deletionRegistry` v1 in `src/domain/privacy/` covering all tables that exist today, plus the
  completeness test from [../PRIVACY_AND_DELETION.md](../PRIVACY_AND_DELETION.md#deletion-registry):
  **any user-owned table absent from the registry fails CI.**
- `purge_deleted` job hard-deletes the reading and every dependent artifact, writing a
  `deletion_receipts` row with per-table counts.
- Destructive confirmation UI names exactly what will be deleted; no accidental-tap deletion.

### 5. Export v1 (FR-22)
- `export_user_data` job → zip of per-type JSON + `links.json` + `manifest.json` (schema version,
  timestamp, counts). Stable IDs and relationships preserved (§13 portability).
- Delivered via a short-lived signed URL; Profile shows export history and status.
- Export is available to **every** plan, always (invariant 11).

### 6. Profile wiring
Enable the Export and Delete sections for real; add "Delete AI artifacts only" (removes
interpretations, keeps raw text) as §10 user control.

### 7. Demo data
Extend seed to produce searchable variety: readings with long notes, readings with no question,
back-dated physical readings, a few soft-deleted rows to exercise purge.

## Test plan

- [ ] Integration: pagination stability while rows are inserted; FTS matches on question and notes;
      card search via alias returns correct deck-native labels; filter composition produces correct SQL
      results (table-driven over combinations).
- [ ] Note revisions: editing notes three times retains all three versions and the current text.
- [ ] Stale interpretation: changing a card marks stale; label shown; no automatic regeneration.
- [ ] **Invariant `deleting-reading-purges-derived.test.ts` — unskip and pass:** after purge, no
      `reading_cards`, `interpretations`, or (once they exist) extraction/embedding/link rows remain,
      and a `deletion_receipts` row records the counts.
- [ ] **Invariant `raw-text-never-overwritten.test.ts` — unskip and pass.**
- [ ] Deletion-registry completeness test fails when a table is deliberately removed from the registry
      (verify by temporarily removing one, then restore).
- [ ] Export: round-trip test — export a seeded user, assert every reading, card, note, interpretation
      and confirmed link appears with stable IDs; manifest counts match the database.
- [ ] **RLS:** `reading_note_revisions`, `deletion_receipts`; export job cannot be triggered for
      another user's ID; a signed export URL is not guessable and expires.
- [ ] **Invariant `archive-readable-without-subscription.test.ts` — unskip and pass** (plan set to
      `free` with limits exhausted: journal, search, detail and export all still work).
- [ ] Performance: journal list and search p95 at 1000 readings, recorded in the report; 60fps scroll
      verified on a mobile profile.
- [ ] E2E at 390px: search by card name across decks; filter by deck + date; open, edit, delete a
      reading with confirmation; request an export and download it.
- [ ] a11y: filter controls keyboard-operable and labeled; search results announced as a live region;
      destructive confirm focus-trapped.

## Exit criteria

- [ ] Timeline, search and filters work and are fast at 1000 entries with **no AI calls**.
- [ ] Editing preserves all user text; card/deck changes mark interpretation stale honestly.
- [ ] Real deletion with registry, purge job and receipts; completeness test in CI.
- [ ] JSON export complete, portable, available on the free plan.
- [ ] Four invariant tests unskipped and passing.
- [ ] Report + `../PROGRESS.md` + `../PRIVACY_AND_DELETION.md` updated with the registry as built.
