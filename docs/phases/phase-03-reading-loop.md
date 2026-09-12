# Phase 03 — The Reading Loop (no AI)

**Deps:** 01, 02 · **Spec:** §6.2, §6.3, FR-02, FR-03, FR-04, FR-05, §19 · **Outcome:** a user can
create, save and reopen a complete reading — question, spread, deck, digital draw or physical entry,
reversals, their own notes — with **zero model calls anywhere in the flow**.

> Doing the loop before AI is deliberate. It forces the invariants "content saves transactionally
> before AI" and "opening a reading makes no AI call" to be structural rather than aspirational, and it
> means a provider outage can never take this phase's work down.

## Scope

**In:** reading creation flow, server-side RNG draw, physical card entry, reversals, "what I notice"
note, transactional save, reading detail screen, custom spread creation, revisit-date prompt,
follow-up status.

**Out:** interpretation (04) — the detail screen shows an honest "Interpretation not generated yet"
slot. Journal list/search (05). Extraction/entities/journeys (06/07).

## Tasks

From Phase 02 (see [completed/phase-02-report.md](completed/phase-02-report.md) §13):
- Deck data comes from `src/db/queries/decks.ts` (`listDecks`, `listCards(client, deck)` →
  `PickerCard[]` with aliases, `getCardBySlug`, `listSpreads`). Never join the archetype tables in a
  render path; the invariant test scans `app/(app)/decks`, `app/(marketing)/cards|spreads` and the
  `card*.tsx` components — add any new reading routes to its `RENDER_PATHS` list.
- Effective reversals for a reading = `deck.supports_reversals && profile.use_reversals`. Thoth is
  `supports_reversals = false` with null `meaning_reversed`; never draw or enter a reversed Thoth card.
- `CardPicker` takes the active deck's `PickerCard[]` (78 rows, fetched once per reading) and is
  deck-scoped by construction; pass `disabledIds` for already-placed cards and `recentIds` from the
  user's recent readings once those exist. `SpreadLayout` takes `positions` + `layout` from the
  `spreads` row and a `renderSlot(position, index)`; slot heights derive from card aspect 3:5.
- `Card` props: `card: CardView`, `orientation`, `size xs|sm|md|lg`, `caption`, `loading`, `priority`.
  Alt text is deck-native via `cardAltText()`. Set `data-deck` on the reading page root so the accent
  follows the chosen deck (`Card` sets it on itself too).
- `spreads` already supports user-owned rows with RLS (`user_id`, `is_builtin=false`); the layout
  shape is `spreadLayoutSchema` in `src/domain/decks/types.ts`.

### 1. Schema
`readings` and `reading_cards` per [../DATA_MODEL.md](../DATA_MODEL.md#readings--phase-03), with RLS on
both (`reading_cards` via parent-exists policy **plus** denormalised `user_id`). Add user-owned
`spreads` rows support (FR-05). Indexes: `(user_id, created_at desc)`, partial `(user_id, revisit_at)`.

### 2. Draw engine (FR-04, §6.2)
- `src/domain/readings/draw.ts`: pure Fisher–Yates over a supplied card-ID list with an injectable RNG,
  so it is deterministic in tests and cryptographic in production (`crypto.randomInt`).
- Executed **server-side**, before any AI exists in the flow. Persist
  `rng = {algorithm, seed, drawn_at, deck_id, reversal_probability}` for auditability.
- Reversals applied only when the reading uses them; suppressed entirely when the deck or the user
  disables them (§6.7).
- Statistical test: 100k draws uniform within tolerance, no duplicates within a spread, reversal rate
  within tolerance.

### 3. Creation flow (§6.2 — each step one thumb action, every optional step skippable)
1. **Question** — text input, or "Open reflection" with no question (§6.2). Optional voice input via
   the Web Speech API where available, with a graceful absence elsewhere.
2. **Life area** — optional suggestion chips, explicitly skippable, **never required** (§6.2).
3. **Spread** — the 5 built-ins plus the user's custom spreads; one-card is the default fast path.
4. **Deck** — RWS or Thoth, defaulting to `profiles.default_deck_id`, changeable per reading (FR-03A).
   Switching deck visibly changes the accent and card naming immediately.
5. **Source** — digital draw or physical deck, defaulting from `usage_style` (FR-03).
6. **Cards**
   - *Digital:* short shuffle/reveal animation, **skippable by tap**, instant under
     `prefers-reduced-motion` (§6.2). Cards reveal into their spread positions.
   - *Physical:* `CardPicker` per position, orientation toggle per card, reorderable, a back-date
     control for a reading done earlier. Target: **a 3-card physical reading logged in under a minute**
     (§19) — build the flow against a stopwatch, not a guess.
7. **"What I notice"** — free-text, optional, clearly the user's own voice, skippable (§6.2).
8. **Save** — transactional insert of reading + cards, then navigate to the detail screen.
9. **Revisit?** — a lightweight, dismissible timeframe chip row ("in 1 week / 1 month / 3 months /
   no thanks") offered *after* saving, only when the reading has a future-facing shape (FR-14).

Flow rules: state survives a refresh or backgrounding (draft in `sessionStorage` + server draft on
first card); back never loses entered cards; no step can be reached that cannot be completed.

### 4. Reading detail screen (§6.3)
Sections, in this order:
- **At a glance** — question, date, spread, deck, cards in layout, follow-up status.
- **Your interpretation** — inline-editable notes, autosaving, visually first-class and distinct from
  AI text per [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md#distinguishing-user-text-from-ai-text).
- **AI interpretation** — this phase: an honest empty slot ("Not generated"). Phase 04 fills it.
- **Connections** — empty placeholder (07/08).
- **Follow-up status** — unresolved / partly resolved / resolved / no longer relevant, one tap.
- **Controls** — edit metadata (question, date, deck?, cards, spread), delete (confirmed), and
  disabled-labeled placeholders for export/share.
- Per-card expansion shows the **reference** meaning from Phase 02 for that card in that position —
  genuinely useful with no AI at all.

### 5. Custom spreads (FR-05)
Create/name/describe positions with prompts, minimal drag-free layout editor (position count + labels;
coordinates auto-arranged), usable in a reading immediately. User-owned, RLS-protected.

### 6. Demo data
Extend `pnpm demo:seed`: ~20 readings over 6 months across both decks and both sources, varied
spreads, some with notes, some with revisit dates, some resolved. This is the substrate every later
phase tests against.

## Test plan

- [ ] Unit: draw engine (determinism with seeded RNG, uniformity, no duplicates, reversal rate);
      spread-position validation; draft state machine.
- [ ] Integration: create reading digital + physical; transactional rollback leaves **no** partial
      reading if card insert fails; back-dated `occurred_at` persists; custom spread reading saves;
      revisit date persists.
- [ ] **RLS**: `readings`, `reading_cards`, user `spreads` — B cannot read/update/delete A's rows, and
      B cannot insert a `reading_cards` row against A's reading.
- [ ] **Invariant `opening-reading-makes-no-ai-call.test.ts` — unskip and pass.** Spy on the provider;
      assert zero calls across the entire create-and-open flow in this phase.
- [ ] E2E at 390px: digital 3-card RWS reading end to end; physical 3-card Thoth reading with two
      reversals; open-reflection one-card reading with no question and no life area; refresh mid-flow
      and resume without losing cards.
- [ ] **Timed E2E:** physical 3-card log completes in under 60s of interaction time (assert on a
      measured step count / scripted timing; fail the phase if the flow can't hit it).
- [ ] Keyboard-only: complete a full physical reading without a pointer.
- [ ] a11y: axe clean on flow and detail; shuffle animation respects reduced motion; card orientation
      announced in text, not by rotation alone.

Manual:
- [ ] Log a real physical 3-card reading with a stopwatch. Report the time in the completion report.
- [ ] Switch deck mid-flow and confirm names/accent change instantly and correctly.

## Exit criteria

- [ ] Digital and physical readings both save transactionally and reopen correctly.
- [ ] Zero AI calls in the entire phase (invariant test passing).
- [ ] RNG is server-side, audited in `readings.rng`, statistically verified.
- [ ] Reading detail shows reference meanings per position without AI.
- [ ] Custom spreads work end to end.
- [ ] Physical 3-card logging measured under a minute; time recorded in the report.
- [ ] Demo seed produces a 6-month reading history.
- [ ] Report + `../PROGRESS.md` updated.
