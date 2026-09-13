# Phase 03 — Completion Report

**Status:** complete
**Date:** 2026-09-12
**Phase file:** [../phase-03-reading-loop.md](../phase-03-reading-loop.md)

---

## 1. What was built

A person can now create, save and reopen a complete reading with **no model anywhere in the
flow**. `/reading/new` is a seven-step client wizard over a pure draft state machine
(`src/domain/readings/draft.ts`): question or open reflection (with Web Speech voice input where
the browser has it), an optional and skippable life area, spread (the five built-ins plus the
user's custom spreads), deck (switching changes the accent and a "named as in …" preview row
instantly, without leaving the step), source, cards, and "What I notice". Digital draws happen
server-side in `drawCardsAction` — a seeded xoshiro128** Fisher–Yates over the deck's 78 IDs,
persisted in `readings.rng` and replayable — and are revealed by a short, skippable, reduced-
motion-aware `ShuffleReveal`. Physical entry is `CardEntry`: the spread with the active slot, one
row per position with a labelled Reversed toggle (never shown for Thoth), move up/down, remove, a
back-date control, and the Phase 02 `CardPicker` focused underneath, so a three-card reading is
three searches and three Enters. Saving is one call to the `create_reading()` Postgres function
(`SECURITY INVOKER`, so RLS applies): reading + cards commit together or not at all, and database
triggers refuse a card from another deck or a reversed card on a deck/reading without reversals.
The draft lives in sessionStorage from the first keystroke and in `reading_drafts` from the first
card, so a refresh, a backgrounded tab or a fresh tab resumes exactly where it was. The detail
screen (`ReadingDetail`) shows §6.3 in order — at a glance, the user's autosaving interpretation,
an honest "Not generated" AI slot, per-card expansion with the deck-native reference meaning for
that orientation and position, a connections placeholder, one-tap follow-up status, and
edit/delete controls with labelled Phase 05 placeholders for export/share — and offers a
dismissible "Revisit this?" chip row once, right after saving a future-facing reading. Custom
spreads are created at `/reading/spread/new` with auto-arranged layouts and usable immediately.
Home's "Still open" slot shows the latest unresolved reading. `pnpm demo:seed` now writes 40
readings over six months for the two demo users. The invariant
`opening-reading-makes-no-ai-call` is live.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Transactional save is a `SECURITY INVOKER` Postgres function (`create_reading`)** called through `client.rpc()` | PostgREST has no multi-statement transactions; a service-role Drizzle transaction would bypass RLS and have to trust a `user_id` from the server. The invoker function runs as the caller, `user_id` is always `auth.uid()`, RLS remains the safety net, and any failure (card count, foreign deck, reversal rule) rolls the whole reading back. Proven by an integration test that leaves zero readings and zero orphan cards after a failed insert. | Admin transaction; two client inserts with a compensating delete. |
| **Deck and reversal rules are database triggers, not only Zod** | "Never draw or enter a reversed Thoth card" and "a card belongs to the reading's deck" are invariants of the data, not of one code path. `reading_cards_check_deck` and `readings_check_deck` refuse the rows regardless of which client wrote them; tests bypass Zod to prove it. | Application-only validation. |
| **Seeded xoshiro128\*\* with a 128-bit `crypto.randomBytes` seed**, not `crypto.randomInt` per pick | The phase asks for `rng = {algorithm, seed, …}` for auditability. Persisting a seed only means something if the draw is a deterministic function of it: `replayDraw()` reproduces the exact cards and orientations. A 32-bit seed cannot reach every 5-card outcome (≈ 9·10¹⁰ > 2³²), so the seed is 16 bytes. Entropy is still cryptographic; only the expansion is deterministic. | `crypto.randomInt` for each pick (unreplayable); a 32-bit `mulberry32`. |
| `readings.spread_id` and `deck_id` have **no cascade** (`NO ACTION`) | Deleting a custom spread that readings use must not orphan or delete readings. `NO ACTION` is checked at statement end, so an account deletion that cascades to both `spreads` and `readings` still succeeds; a direct spread delete is refused and the UI says so. (`RESTRICT` would have broken account deletion depending on cascade order.) | `on delete restrict`; `set null` with a snapshot column. |
| **`reading_drafts` is its own one-row-per-user table**, not a draft status on `readings` | The phase asks for a server draft from the first card. A `status` column on `readings` would leak half-finished rows into every later phase (journal, extraction, correlation) and into the invariant tests. A separate jsonb payload keeps `readings` meaning "saved", is trivially RLS'd and deleted on save. | `readings.saved_at null` = draft. |
| **Reversals e2e runs on RWS; Thoth asserts that no reversal control exists** | The phase file's "physical 3-card Thoth reading with two reversals" predates Phase 02's decision that Thoth is `supports_reversals = false` (dignity, not reversal). The intent — reversals entered by hand and shown in text — is proven on RWS; Thoth is proven to offer none, in the UI, in Zod and at the database. | Adding reversals to Thoth to satisfy the sentence. |
| Deck step is **select + Continue**; every other choice step is **tap-to-advance** | "Switching deck visibly changes the accent and card naming immediately" needs the user to stay on the step to see it, so the deck step keeps you there with the default preselected (one tap for most people). Life area, spread and source advance on tap — one thumb action each. | Tap-to-advance everywhere (deck switch invisible); Continue everywhere (two taps per step). |
| On the physical cards step the **picker takes focus, not the heading** | `FocusHeading` moving focus to the step title cost a Tab per reading and fought the picker's `autoFocus`. The picker's label names the position ("Card for position 1: Situation"), so screen-reader context is kept. Every other step still focuses the heading. `FocusHeading` grew an `autoFocus` prop. | Heading focus everywhere. |
| `ChoiceButton` selected state is an **outline**, not a ring | The `hairline` utility sets `box-shadow` and wins over Tailwind's ring variables, so `selected` was invisible — in Phase 01's onboarding too. Found by screenshot review. | Removing `hairline` when selected. |
| Drawn-card names are listed **only after the reveal finishes** (or is skipped) | The list under the animation spoiled the reveal. `ShuffleReveal` reports `onDone`. Continue stays enabled throughout — nothing traps the user in an animation. | Listing immediately; disabling Continue until done. |
| Timestamps render via `LocalTime` (server UTC → browser zone after mount) | `profiles.timezone` defaults to `UTC` and onboarding never sets it; formatting in the browser's zone is what a journal reader expects. `<time dateTime>` carries the exact instant either way. | Server-side formatting in the profile zone. |
| Hard delete now; `deleted_at` stays unused | Nothing derived exists yet; `reading_cards` cascade. Phase 05 brings the purge job and the soft-delete path with the derived tables. | Soft delete with no consumer. |
| Edit covers question, open reflection, life area, date and cards (same deck and spread) | The phase file marks deck as "deck?"; a deck or spread change invalidates every card, so the honest path today is to re-log (under a minute). Cards are replaced atomically via `replace_reading_cards()`, which bumps `metadata_version`. | Full re-pick on deck change inside edit. |
| Custom spread position prompts are optional in the UI | `spreadPositionSchema` needs ≥ 20 characters; users should not have to write prompts. Empty prompts get a neutral default ("What this card suggests in the position …"). | Requiring prompts. |
| Life areas are eight stable keys in `domain/readings/types.ts` | Spec §13: taxonomy keys are machine strings, labels are separate. Phase 06's inferred life areas can reuse the same keys. | Free-text life area. |
| Playwright `expect` timeout raised to 10 s | One failure in eight full runs, under 8 parallel workers on one `next start`, on an assertion waiting for a server action + `router.refresh()`; never reproduced in isolation. The suite is otherwise unchanged. | Retries; serial workers. |

## 3. Files and modules

```
src/domain/readings/
  prng.ts ★                     xoshiro128** seeded RNG, rejection-sampled int(), SEED_BYTES
  draw.ts ★                     drawCards() partial Fisher–Yates, DrawRecord, replayDraw()
  draft.ts ★                    ReadingDraft + Zod, FLOW_STEPS, reducers (setDeck clears cards …), canAdvance/reachable, toCreateInput
  types.ts ★                    ORIENTATIONS, READING_SOURCES, FOLLOW_UP_STATUSES(+labels), LIFE_AREAS, createReadingInputSchema, updateReadingInputSchema, placedCardSchema, drawRecordSchema
  spreadLayout.ts               autoLayout(count) rows-of-three, slugify(), positionKey()
  futureFacing.ts               isFutureFacing(question, positions) for the revisit offer
  thresholds.ts                 REVERSAL_PROBABILITY 0.5, MAX_BACKDATE_YEARS, custom-spread bounds, REVISIT_OFFSETS
  __tests__/draw.test.ts ★, draft.test.ts ★, spreadLayout.test.ts, futureFacing.test.ts

src/db/
  schema/readings.ts ★          readings, reading_cards, reading_drafts + policies + checks
  migrations/0004_readings.sql ★  generated DDL + hand-written triggers, create_reading(), replace_reading_cards(), grants, comments
  queries/readings.ts ★         createReading (rpc) / getReading (one embedded select) / listReadings / listRecentCardIds / updateReading / updateReadingNotes / setFollowUpStatus / setRevisitAt / replaceReadingCards (rpc) / deleteReading / server draft get·upsert·delete
  queries/spreads.ts ★          customSpreadInputSchema, buildCustomSpread, createCustomSpread (slug retry), listCustomSpreads, deleteCustomSpread ('in_use')
  queries/decks.ts              exports DECK_COLUMNS / CARD_VIEW_COLUMNS / SPREAD_COLUMNS / toCardView / RawCard
  queries/__tests__/readings.integration.test.ts ★
  __tests__/readings.rls.test.ts ★

app/(app)/reading/
  actions.ts ★                  drawCardsAction, saveReadingAction, saveDraftAction, clearDraftAction, updateNotesAction, setFollowUpAction, setRevisitAction, updateReadingAction, deleteReadingAction, createSpreadAction, deleteSpreadAction
  new/page.tsx ★                loads both decks' cards, spreads, profile defaults, recent ids, server draft
  new/reading-flow.tsx ★        the wizard: steps, sessionStorage + debounced server draft, save → /reading/[id]?saved=1
  new/voice-input.tsx           Web Speech API button; renders nothing where absent
  [id]/page.tsx ★               getReading → ReadingDetail with client islands; 404 on miss
  [id]/controls.tsx             NotesEditor, FollowUpControl, RevisitChips, ReadingControls (ConfirmDestructive delete)
  [id]/edit/page.tsx, edit-form.tsx   metadata + cards edit
  spread/new/page.tsx, spread-builder.tsx ★   custom spread builder with live layout preview, own-spreads list + delete
app/(app)/home/page.tsx         "Still open" shows the latest unresolved reading

src/ui/components/
  reading-detail.tsx ★          §6.3 sections; CardInPosition <details> with position prompt, keywords, meaning
  card-entry.tsx ★              physical entry control
  shuffle-reveal.tsx ★          ShuffleReveal + CardBack
  user-note-editor.tsx          autosaving textarea, status live region
  local-time.tsx                LocalTime, formatReadingDate
  choice-button.tsx             selected = outline (fix); focus-heading.tsx  autoFocus prop

src/__tests__/invariants/opening-reading-makes-no-ai-call.test.tsx ★   (placeholder .ts removed)
src/__tests__/invariants/thoth-never-substitutes-rws.test.tsx   + reading render paths, readings query scan
src/__tests__/rls/harness.ts    + idColumn option
src/domain/privacy/deletionRegistry.ts   reading → reading_cards; user → readings, reading_cards, reading_drafts

scripts/seed-demo-readings.ts ★  40 authored stories, deterministic draws, regenerated per run
scripts/seed-demo.ts             registers the readings seeder
e2e/reading.spec.ts ★            9 tests × 2 projects; e2e/_helpers.ts (300 ms settle before axe); onboarding.spec.ts updated
playwright.config.ts             expect timeout 10 s
```

## 4. Database changes

`0004_readings.sql` (`drizzle-kit generate --name readings`, then hand-written after the marker):

- `readings` (18 columns; checks `readings_source_rng_check` `(source='digital') = (rng is not
  null)` and `readings_question_check`; FKs `user_id` cascade, `spread_id`/`deck_id` no action;
  indexes `(user_id, created_at desc)`, `(user_id, occurred_at desc)`, partial `(user_id,
  revisit_at) where revisit_at is not null`; the four standard policies).
- `reading_cards` (10 columns incl. denormalised `user_id` and `created_at`; check
  `position_index >= 0`; unique `(reading_id, position_index)`; index `(user_id, created_at
  desc)`; select/delete on `user_id = auth.uid()`, insert/update additionally `exists (select 1
  from readings r where r.id = reading_id and r.user_id = auth.uid())`).
- `reading_drafts` (`user_id` PK, `payload jsonb`, `updated_at`; four policies).
- Hand-written: `set_updated_at` triggers on `readings` and `reading_drafts`;
  `readings_check_deck()` (+ trigger on insert / update of `deck_id`, `uses_reversals`);
  `reading_cards_check_deck()` (+ trigger on insert / update of `card_id`, `orientation`,
  `reading_id`); `create_reading(jsonb) returns uuid` and `replace_reading_cards(uuid, jsonb)`,
  both `SECURITY INVOKER`, `set search_path = public`, `REVOKE … FROM public` then `GRANT
  EXECUTE … TO authenticated, service_role`; table and function comments.

DATA_MODEL.md rewritten for the readings section (columns added: `deck_size` in `rng`,
`reading_cards.user_id/created_at`, `reading_drafts`, checks, triggers, functions) and the RLS
pattern paragraph on child tables. Later phases: `interpretations` must reference
`readings.metadata_version`; the Phase 05 purge job must handle `deleted_at` and `reading_drafts`.

## 5. AI tasks touched

None — by design. No file reachable from the reading routes imports `src/ai/` (asserted by the
invariant test's import-graph scan). Phase 04 adds interpretation *after* `saveReadingAction`
returns, never inside it.

## 6. Thresholds and constants

| Constant | Where | Value | Evidence |
|---|---|---|---|
| `REVERSAL_PROBABILITY` | `src/domain/readings/thresholds.ts` | 0.5 | ALGORITHMS §6; measured 0.5 ± 0.005 over 300k draws |
| `SEED_BYTES` | `prng.ts` | 16 | 2¹²⁸ states ≫ 5-card outcomes from 78 |
| `MAX_BACKDATE_YEARS` | `thresholds.ts` | 10 | back-date input `min` |
| `CUSTOM_SPREAD_MIN/MAX_POSITIONS` | `thresholds.ts` | 1 / 10 | `autoLayout` tested 1–10, no overlap |
| `REVISIT_OFFSETS` | `thresholds.ts` | 7 / 30 / 90 days | FR-14 chips |
| `SHUFFLE_MS`, `REVEAL_STAGGER_MS` | `shuffle-reveal.tsx` | 1100 / 380 | "short" (§6.2); skippable by one tap |
| `SERVER_DRAFT_DEBOUNCE_MS` | `reading-flow.tsx` | 1200 | one upsert per pause, not per keystroke |
| `UserNoteEditor` autosave | `user-note-editor.tsx` | 900 ms + blur | |
| `QUESTION_MAX` / `NOTES_MAX` | `types.ts` | 500 / 5000 chars | |

ALGORITHMS.md §6 updated to the seeded design.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `domain/readings/__tests__/draw.test.ts` (8) | PRNG determinism per seed, seed validation, range/bias guards; draw determinism and `replayDraw` equality; **never a reversed card when reversals are off** (2 000 draws); input validation; **100k three-card draws**: every card within 5σ of uniform in every position, no duplicate within a spread, reversal rate within 0.005 of 0.5; partial shuffle = prefix of full shuffle |
| unit | `domain/readings/__tests__/draft.test.ts` (13) | defaults from profile (Thoth/reversals-off → no reversals); §6.2 step order; question-or-open-reflection gate; life area never required; unreachable steps never reachable; spread resize keeps physical cards; digital draw discarded on spread/deck/source change; deck switch clears cards and re-derives reversals; place/remove/toggle/swap/next-empty; **back never loses cards**; `toCreateInput` shape and the rng/reversal/question refinements; restore rejects malformed drafts |
| unit | `spreadLayout.test.ts` (3), `futureFacing.test.ts` (3) | 1–10 positions inside the canvas with no overlap, centred last row, bounds; slugs and unique position keys; future-facing by spread or by question, not for a one-card open reflection |
| unit (invariant) | `__tests__/invariants/opening-reading-makes-no-ai-call.test.tsx` (3) | see below |
| unit (invariant) | `thoth-never-substitutes-rws.test.tsx` (updated) | reading routes, `readings.ts`, `reading-detail`, `card-entry`, `shuffle-reveal` contain no archetype reference; `readings.ts` selects only `readings`/`reading_cards`/`reading_drafts` and names no archetype table in embeds |
| unit | `db/__tests__/deletion-registry.test.ts` (updated) | registry covers `readings`, `reading_cards`, `reading_drafts` |
| integration | `db/queries/__tests__/readings.integration.test.ts` (10) | physical 3-card RWS create → reopen with deck-native cards, position keys/names/prompts, reversed meaning present; digital create with a real draw whose stored `rng` **replays to the same cards**; Thoth reading with no reversals and **a reversed Thoth card refused by the trigger (`23514`) even when Zod is bypassed**; **rollback: a foreign-deck card leaves zero readings and zero orphan cards**, wrong card count refused; back-dated `occurred_at` persists and orders the list; custom spread created (slug, keys, default prompts, layout), same name → `-2` slug, used in a reading, **delete refused while in use**, then deleted; revisit / follow-up / notes / metadata persist, cards replaced atomically with `metadata_version` bump, a bad replacement leaves the previous cards; recent card ids newest-first, deduped, deck-scoped; delete cascades cards; server draft round-trips |
| rls | `db/__tests__/readings.rls.test.ts` (3) | `readings` standard isolation; `reading_cards` isolation **plus** B cannot insert a card against A's reading with B's own `user_id`, cannot re-point their card at A's reading, `create_reading` as B creates B's reading even with A's id in the payload, anon cannot call it, B's `replace_reading_cards` on A's reading → `P0002`; `reading_drafts` isolation (`idColumn: 'user_id'`) |
| e2e | `e2e/reading.spec.ts` (9 × 2) | **digital 3-card RWS** end to end (deck switch shows Thoth names/accent in place and never Pentacles/Strength; "no model chooses your cards"; skip animation; three drawn cards by position; save → `?saved=1`, timeline line, "Not generated.", notes prefilled; revisit chips → persisted chip; follow-up one tap → persisted; notes autosave survives reload; per-card expansion shows hedged reference text; axe ×3); **physical 3-card RWS with two reversals** (auto-advancing picker labels, position list, `aria-pressed` toggles, `img` name "Strength, reversed — Rider–Waite–Smith", outcome spread offers revisit, "No thanks" dismisses) **then Thoth** (alias "strength" shows Lust labelled *also "Strength"*, no `Reversed:` button exists, detail body free of Strength/Pentacles/Rider/Waite, axe); **open reflection one-card** (no question, no life area, no revisit offer, Home "Still open" link); **refresh mid-flow** resumes with both cards, **a fresh tab restores from the server draft**, Back keeps cards; **timed scripted** (14 interactions) and **timed human-paced** (< 60 s asserted); **keyboard-only** physical reading incl. arrow keys and Space on the toggle; **reduced motion** reveals instantly with no skip button; **custom spread** create → use → edit (question, reverse, reorder) → spread delete refused while in use → reading delete confirmed → Home → spread deleted |
| e2e | `e2e/onboarding.spec.ts` (updated) | onboarding now lands on the real "What are you asking?" and reaches Home via the nav, keyboard-only |

Invariant tests unskipped this phase:
- [x] `opening-reading-makes-no-ai-call.test.tsx` — (1) the transitive first-party import graph
      from `app/(app)/reading`, `app/(app)/home`, the reading/spread queries and the detail/entry/
      reveal/note components contains no file under `src/ai/` (and does reach the query layer and
      `Card`); (2) with `@/ai`, `@/ai/index`, `@/ai/run` and `@/ai/providers/mock` replaced by a
      throwing spy, `getReading` against a PostgREST-shaped fake touches only `readings` (one
      embedded select, no RPC) and maps cards, orientation and positions correctly; (3)
      `renderToStaticMarkup(<ReadingDetail/>)` for an RWS and a Thoth reading contains the
      question, "Not generated.", the timeline line, every card name, position name and the
      reference meaning for its orientation, deck-native alt text, and no RWS vocabulary for
      Thoth — with the spy never called.

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  20 passed | 10 skipped (30)
      Tests  149 passed | 10 skipped (159)        Duration 2.86s
 Test Files  6 passed (6)
      Tests  35 passed (35)                       Duration 6.86s

$ pnpm test:rls
 Test Files  6 passed (6)
      Tests  15 passed (15)                       Duration 5.65s

$ pnpm build && pnpm check:client-bundle
 ✓ Compiled successfully in 4.2s
├ ƒ /home 659 B · /reading/[id] 4.98 kB · /reading/[id]/edit 5.3 kB · /reading/new 50.2 kB · /reading/spread/new 5.8 kB
check-client-bundle: ok (59 files scanned)

$ pnpm test:e2e            (mobile 390×844 + desktop)
  90 passed (1.1m)  — eight full runs after the last code change: 90/90 ×7, one run 89/90
  (load-related; see §11), then 90/90 ×2 with the 10 s expect timeout
  e2e stats: expected 90, unexpected 0, flaky 0

$ pnpm db:migrate
migrations applied
$ curl localhost:3100/api/health
{"status":"ok","db":true,"migration":{"current":true,"expected":"0004_readings",...},"provider":{"provider":"mock",...}}

$ pnpm demo:seed && pnpm demo:seed
seeding readings (phase 03)
  40 readings across 2 users (6 months)
demo seed complete
```

Database spot-check (psql in the Supabase container, demo users):
```
 demo-ana | 20 readings | 19 digital | 4 thoth | 9 notes | 5 revisit | 5 resolved | 5 spreads | 2026-03-18 → 2026-09-12
 demo-ben | 20 readings |  1 digital |17 thoth | 9 notes | 4 revisit | 7 resolved | 5 spreads | 2026-03-15 → 2026-09-12
 reading_cards by deck/orientation: rws upright 23 · rws reversed 26 · thoth upright 59 · thoth reversed 0
 functions: create_reading, replace_reading_cards, readings_check_deck, reading_cards_check_deck (all prosecdef = f)
 policies: 4 × readings, 4 × reading_cards, 4 × reading_drafts
```

| Metric | Target | Measured |
|---|---|---|
| Physical 3-card log, scripted interaction time | < 60 s | 1.1–1.2 s (14 interactions incl. typing) — `physical-3-card-ms` |
| **Physical 3-card log, human-paced** (120 ms/keystroke, 700 ms think per tap, 40-char question, one reversal) | < 60 s | **20.1 s mobile · 19.8 s desktop** — `physical-3-card-human-paced-ms` |
| Interactions per card (picker) | ≤ 3 | 2 (type, Enter) after the first; slot auto-advances |
| Draw uniformity (100k × 3 cards) | within tolerance | max deviation < 5σ; 0 duplicates; reversal rate 0.5 ± 0.005 |
| Unit / integration / RLS | fast | 2.9 s / 6.9 s / 5.7 s |
| E2E (90 tests, 2 projects) | — | ~66 s |
| `/reading/new` first-load JS | — | 196 kB (both decks' 156 cards ship as props; see §11) |

Manual checks actually performed:
- [x] **Stopwatch-equivalent timed run**: the human-paced e2e above is the recorded figure (a
      real human typing a 40-character question and three card names, toggling one reversal:
      ~20 s). No physical stopwatch session was possible in this environment; the scripted pace is
      deliberately slow (120 ms per key ≈ 80 wpm hunt-and-peck).
- [x] **Deck switch mid-flow** (e2e + screenshots, light and dark): tapping Thoth on the deck step
      turns the step's Continue and the preview violet and the preview row reads Lust · The
      Universe · Princess of Disks; tapping back shows Strength · The World · Page of Pentacles.
      Card names in the picker and layout follow the deck. Asserted in `reading.spec.ts`.
- [x] **390 px screenshots reviewed, light + dark** (15 screens each): question, life area, spread,
      deck (Thoth), source, physical cards with a reversed Tower, notes, detail just saved, detail
      with a card expanded, digital draw intro, shuffle, mid-reveal, reveal done, spread builder,
      Home with "Still open". Fixed from this review: invisible `ChoiceButton` selection, spoiler
      list under the reveal, duplicated position legend on the detail page, UTC timestamps, the
      truncated "· reversed" in the position row (moved to the position line).
- [x] **Keyboard only**: the `keys` e2e never clicks — Tab/Enter through every step, typing and
      arrow keys in the picker, Space on the Reversed toggle, Enter on Save.
- [x] **Reduced motion**: `emulateMedia({ reducedMotion: 'reduce' })` — the drawn card is on screen
      immediately and there is no "Skip animation" button.
- [x] Orientation announced in text: card `img` names ("Strength, reversed — …"), the position
      rows ("Situation · reversed"), the drawn-cards list and the detail list all carry the word.
- [ ] PWA install on a physical phone — **still no device**; moved to Phase 12.

## 9. UX notes

States: the flow shows a two-line skeleton for the one tick before the draft is restored; the
draw button reads "Shuffling…" while the action runs and shows an honest error with a retry
("The draw did not go through. Try again in a moment."); save failures keep everything on screen
("Nothing you entered is lost — it's still on this screen"); the note editor's status line is
Saving / Saved / could not save and never touches the text; follow-up chips are optimistic and
revert with a message; the AI slot is an explicit "Not generated." in the tinted AI container so
the contract (user text = serif on paper, AI text = sans in a tinted container with a left
hairline) is learnable before any AI exists; Connections is a dashed placeholder that says what
will fill it; export/share are labelled Phase 05 and `aria-disabled`.

Design system extended with `ShuffleReveal`, `CardBack`, `CardEntry`, `UserNoteEditor`,
`ReadingDetail`, `LocalTime`; `ChoiceButton` selection fixed; `FocusHeading` gained `autoFocus`.

Rough edges left deliberately: the deck step's preview row is three fixed cards per deck
(Strength/The World/Page of Pentacles vs Lust/The Universe/Princess of Disks) — chosen because
they are exactly the names that differ; the back-date control is a native `datetime-local`
(fine on phones, plain on desktop); the reveal's card backs are a lattice in the deck accent, not
artwork; the Celtic-cross reveal stacks the crossing card on the centre card as the layout
dictates, which reads correctly once revealed but is a dense moment mid-animation; `/reading/new`
ships both decks' cards (≈ 80 kB of JSON) so deck switching is instant — acceptable now, could
become per-deck lazy loading if the payload grows; in the Thoth picker, typing "strength" ranks
the Nine of Wands (titled *Strength*) above Lust (alias) per Phase 02's ranking — correct, and the
alias line makes Lust findable, but worth a UX look.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| PWA install on a physical phone | No device in this session either | 12 |
| Change deck or spread of a saved reading | Would invalidate all cards; re-logging takes < 1 min. Edit covers question, reflection, life area, date and cards | 05 if asked |
| Soft delete via `deleted_at` + purge job | Nothing derived exists to purge; hard delete cascades `reading_cards` | 05 |
| Physical stopwatch by a human | No human in the loop this session; the human-paced e2e (20 s) is the recorded measurement | owner, any time |
| Photo recognition of physical cards | Spec calls it a later enhancement (`FLAG_PHYSICAL_PHOTO_OCR`) | later |

## 11. Known issues and risks

- **One e2e failure in eight full runs** (`digital three-card … revisit and follow-up`, mobile)
  under 8 parallel workers on a single `next start`; not reproducible in 11 isolated or full
  reruns. The likely cause is a server action + `router.refresh()` round-trip exceeding the 5 s
  expect timeout under load; the global expect timeout is now 10 s. If it recurs, the follow-up
  chip assertion is the place to look.
- `reading_drafts` payload is user content (question, notes) stored server-side before save; it is
  RLS'd and deleted on save, but a Phase 12 privacy sweep should include it in export/delete.
- The server draft is upserted 1.2 s after the last change; a device dying inside that window
  loses at most one card. sessionStorage covers the same tab regardless.
- `SpeechRecognition` support is detected only on the client, so the "Speak instead" button
  appears after hydration; audio is processed by the browser's own recogniser (Chrome sends it to
  Google) — the app receives text only, but the privacy page should say so when voice is promoted.
- `create_reading` trusts `p->>'occurred_at'` up to the timestamptz cast; the Zod schema already
  requires a valid ISO string and the UI clamps to `MAX_BACKDATE_YEARS`, but there is no DB check
  against future dates.
- The flow keeps both decks' 78-card lists in the client tree; a third deck would add ≈ 40 kB.
- Colour transitions on chips are 150 ms; axe is now run 300 ms after navigation/interaction in
  `expectNoSeriousA11y`, otherwise it samples a blended colour and reports a false contrast failure.
- `formatReadingDate` in `LocalTime` uses the `en` locale; `profiles.locale` exists but is not
  wired to it yet.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm demo:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Sign in as `demo-ben@tarot.local` / `demo-password-123` → Home shows "Still open" with a recent
   Thoth reading; open it: cards in position, your notes, "Not generated." under AI interpretation,
   expand a card for its Thoth-native meaning; no "Strength"/"Pentacles" anywhere.
2. Start a reading → type a question → Skip → *Situation · Advice · Outcome* → tap Thoth then
   Rider–Waite–Smith and watch the accent and the "Named as in …" row change → Continue → *Enter my
   physical cards* → type `strength` ⏎ `tower` ⏎ `ace of cups` ⏎ → tap Reversed on one → Continue →
   write a line → Save reading. You land on the detail with the timeline line and "Revisit this?".
3. Reload `/reading/new` half-way through a physical entry (or open it in a new tab): the cards
   are still there. Back never loses them.
4. Start a digital reading with Thoth and the Celtic cross: "Draw 5 cards" → watch or skip the
   reveal → names appear only once revealed. With OS reduced motion on, it is instant.
5. `/reading/spread/new`: name four positions, save, use it immediately from the spread step.
   Try deleting it while a reading uses it — refused with a message.
6. Edit a reading (question, reversal, reorder), then Delete → confirm → Home.

## 13. Notes for the next phase

- `getReading()` returns everything `interpret_reading` needs: `spread.positions[].prompt`,
  `deck.system`, each card's full reference row and orientation, `user_notes`. Do not add joins to
  archetype tables; the invariant scans `readings.ts`.
- The AI slot to replace is the "AI interpretation" section of
  `src/ui/components/reading-detail.tsx`; keep the section order and the container contract. Pass
  the streaming component through the `slots` prop from `app/(app)/reading/[id]/page.tsx` so the
  presentational component stays renderable in the invariant test with `slots` nulled.
- Trigger interpretation from the `?saved=1` landing (a client island or a route handler the flow
  calls after `saveReadingAction` returns), never inside the save. The import-graph invariant
  will fail if anything under `app/(app)/reading` imports `src/ai/` at module level — put the call
  behind a route handler under `app/api/readings/[id]/interpret` as the phase file already says.
- `readings.metadata_version` changes when cards are replaced; store it on the interpretation so
  an edited reading can show "interpretation is for an earlier version of the cards".
- Consent gate is `hasAiConsent(profile)`; `demo-ana` (on) and `demo-ben` (off) each have 20
  readings across both decks and all five built-in spreads for testing both paths.
- The RLS harness now takes `idColumn`; the a11y helper waits 300 ms before axe; Playwright
  `expect` timeout is 10 s.
- These notes are now in the Phase 04 file.
