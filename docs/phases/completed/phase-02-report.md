# Phase 02 — Completion Report

**Status:** complete
**Date:** 2026-09-12
**Phase file:** [../phase-02-deck-reference.md](../phase-02-deck-reference.md)

---

## 1. What was built

Both deck systems now exist as first-class, deck-native reference data. Migration
`0003_deck_reference` adds `decks`, `cards`, `card_archetypes`, `card_archetype_members`,
`card_aliases` and `spreads` (anon + authenticated read, service-role write) and the missing
`profiles.default_deck_id → decks` FK. `pnpm db:seed` upserts 156 authored cards from typed TS
modules under `src/db/seed/decks/` — RWS with Page/Knight/Queen/King and Pentacles, Thoth with
Knight/Queen/Prince/Princess, Disks, Crowley's Atu names (Adjustment, Lust, Art, The Aeon, The
Universe, The Magus, The Priestess, Fortune), small-card titles, decans, sephiroth and Hebrew
letters — plus 78 neutral archetype slots, 161 aliases and 5 laid-out spreads. It is idempotent to
the byte (an integration test digests every row before and after a second run). The 1909 Pamela
Colman Smith artwork is bundled from Wikimedia Commons as AVIF/WebP at three widths; Thoth ships
no scans and is rendered by a designed typographic face. `Card`, `CardPicker` (in-memory,
alias-aware, keyboard-first, deck-scoped) and `SpreadLayout` (relative coordinates) are in the
gallery; `/decks` browses both decks in-app; `/cards/[deck]/[slug]`, `/cards`, `/spreads` and
`/spreads/[slug]` render server-side for anonymous visitors with canonical URLs and JSON-LD and one
funnel line each. Profile has real "Default deck" and "Reversals" controls. The invariant test
`thoth-never-substitutes-rws` is live in three layers: seed data, a source scan of every render
path for archetype references, and the actual `Card` markup.

## 2. Decisions made

| Decision | Reasoning | Alternative rejected |
|---|---|---|
| **Thoth `supports_reversals = false`, `meaning_reversed = null` on all 78 rows** | The phase file says the deck flag "disables them entirely for Thoth"; *The Book of Thoth* reads by elemental dignity and position, and the detail page says so in place of a reversed section. Effective reversals for a reading = `deck.supports_reversals && profile.use_reversals`. Flipping the flag later is a data change, not a code change. | Leaving Thoth reversible with authored reversed text (would contradict the deck's own practice and double the Thoth authoring for text the tradition does not use). |
| Search is a **pure in-memory function** (`src/domain/decks/search.ts`) over the deck's 78 rows + aliases; the trigram indexes exist but no SQL search RPC | 78 cards fit in ~40 kB; searching client-side is what makes the picker respond per keystroke with zero round-trips and makes ranking unit-testable (exact > prefix > token-prefix > contains; name > title > alias; Dice-bigram fuzzy fallback). The GIN trigram indexes are there for the Phase 05 journal search. | Server-side `search_cards()` RPC per keystroke. |
| `correspondences jsonb` is the single typed bag (Zod `correspondencesSchema`); **no separate `qabalah` column** | One validated shape for both decks; RWS fills element/planet/zodiac/decan, Thoth adds sephira/path/hebrew letter/esoteric title. DATA_MODEL.md updated. | Two overlapping JSON columns. |
| Added `cards.title`, `cards.suit_label`, `cards.numeral`, `spreads.card_count` | Thoth practice is title-led ("Dominion"); `suit_label` keeps the display vocabulary deck-native without a lookup; `numeral` is what the card prints; `card_count` avoids counting JSON on list pages. | Deriving them in code from RWS-centric tables. |
| Archetype `label`s are neutral ("Major VIII", "Two of the earth suit") and a test asserts no label equals any card name | The slot must not silently promote one deck's name. `mapping_note` on every mismatched membership says the correspondence is structural. | Labelling slots with RWS names "for convenience". |
| **Court aliases use only rank words that exist in one deck** (Page/King → RWS; Princess/Prince → Thoth); Thoth Prince gets no "Knight of …" alias | "Knight of Wands" is a real Thoth card; an alias with that text on the Prince would make a deck-scoped search show two cards under one name. A test asserts no alias equals another card's name in the same deck. The Prince↔RWS-Knight correspondence lives in the archetype mapping instead. | Full symmetric court aliases. |
| Court sort order is structural (lowest first: Princess/Page 0 … Knight/King 3) | Same position means the same thing in both decks' `sort_order`, which keeps grids and archetype slots aligned. Thoth books list Knight first; the grid shows Princess first. Cosmetic; revisit if Thoth readers object. | Deck-specific court order. |
| RWS art via plain `<picture>` + hand-built srcsets, not `next/image` | Assets are already optimised AVIF/WebP at 160/320/640; the optimizer would re-encode and add a runtime dependency. 468 files, 27 MB committed. | `next/image` with a remote/local loader. |
| Public reference index pages are `force-dynamic`; parameterised pages use `revalidate = 3600` | `/cards` and `/spreads` were being prerendered at `next build`, which would make a hosted build depend on a reachable database. Param pages without `generateStaticParams` render on demand and cache. | Build-time prerender. |
| `NEXT_PUBLIC_SITE_URL` added (default `http://localhost:3000`) and `metadataBase` set in the root layout | Canonical URLs and JSON-LD need an absolute origin. | Hard-coding or `VERCEL_URL`. |
| `/decks` added to `PROTECTED_PREFIXES`; public reference is under `/cards` and `/spreads` | The table-driven route test covers it automatically. In-app browser defaults its tab to `profiles.default_deck_id`. | One route with auth-dependent behaviour. |
| Vitest transforms JSX with `oxc: { jsx: { runtime: 'automatic' } }` | tsconfig says `jsx: preserve` for Next; the invariant test renders `Card` with `react-dom/server`. Vite 8 uses oxc, not esbuild. | jsdom + testing-library (not needed for static markup assertions). |
| `spreads` registered under the `user` root of the deletion registry; the five pure reference tables in `REFERENCE_TABLES` | `spreads` has a nullable `user_id` (custom spreads), so it is user-owned data; the phase file's "add spreads to REFERENCE_TABLES" would have hidden it from the cascade check. | Exempting it. |
| Meanings are original text in the product register (hedged, reflective); a unit test bans predictive verbs | DESIGN_SYSTEM copy rules; also keeps the Thoth text free of quotation from a copyrighted book while staying inside its framework. | Paraphrasing Waite/Crowley closely. |

## 3. Files and modules

```
src/db/
  schema/decks.ts ★                 decks, cards, card_archetypes(+members), card_aliases, spreads + pgPolicy sets
  schema/enums.ts                   + arcana, art_strategy, alias_kind
  schema/profiles.ts                default_deck_id FK → decks (set null)
  migrations/0003_deck_reference.sql ★  generated DDL + hand-written trigram indexes, trigger, comments
  queries/decks.ts ★                listDecks / getDeckBySlug / listCards (PickerCard[]) / getCardBySlug / neighbourCards / listSpreads / getBuiltinSpreadBySlug — cards+decks+aliases+spreads only
  seed/reference.ts ★               seedReferenceData(): idempotent upserts, stale alias/member cleanup; deckIdBySystem()
  seed/decks/_builders.ts           major() / pip() / court() → CardSeed; ROMAN, PIP_WORDS, slugify
  seed/decks/rws.ts ★ + rws-majors.ts, rws-wands-cups.ts, rws-swords-pentacles.ts   78 RWS cards
  seed/decks/thoth.ts ★ + thoth-majors.ts, thoth-wands-cups.ts, thoth-swords-disks.ts  78 Thoth cards
  seed/decks/archetypes.ts ★        78 neutral slots; archetypeKeyFor(); mappingNoteFor()
  seed/decks/aliases.ts ★           161 aliases (cross_deck / search / historical), deduped
  seed/decks/spreads.ts ★           5 built-in spreads with prompts + relative layouts
  seed/__tests__/seed-integrity.test.ts ★, search-with-seed.test.ts, reference.integration.test.ts ★
  __tests__/deck-reference.rls.test.ts ★

src/domain/decks/
  types.ts ★                        Zod: correspondencesSchema, cardSeedSchema, deckSeedSchema, spreadPosition/Layout/SeedSchema; CardView
  search.ts ★                       searchCards(): pure ranking, alias hits carry `via`; similarity()
  glyphs.ts                         planet/zodiac glyphs (text presentation), Hebrew letters, element sigils, suit glyph paths

src/ui/components/
  card.tsx ★                        Card: <picture> art or TypographicFace; reversed = rotate + chip; cardAltText(); artSrcSet()
  card-picker.tsx ★                 CardPicker: combobox/listbox, chips from deck data, recent first, ≤ 3 interactions
  spread-layout.tsx ★               SpreadLayout: absolute slots from relative coords, numbered legend
  card-detail.tsx                   shared reference view (meanings, dignity note, correspondences, neighbours)
  deck-browser.tsx                  client grid with in-memory search + chips (hrefBase)

app/
  (app)/decks/page.tsx ★            deck switcher (links), grid; default tab = profile default deck
  (app)/decks/[deck]/[slug]/page.tsx   in-app card reference
  (app)/profile/page.tsx, controls.tsx  DeckSelect + ReversalsToggle (real controls replace comingIn)
  (app)/home/page.tsx               "Browse the decks" link
  (marketing)/_components/shell.tsx    MarketingShell (one funnel line) + JsonLd
  (marketing)/cards/page.tsx, cards/[deck]/page.tsx, cards/[deck]/[slug]/page.tsx ★   public reference
  (marketing)/spreads/page.tsx, spreads/[slug]/page.tsx ★
  dev/ui/page.tsx (loads real rows), dev/ui/deck-gallery.tsx ★ (Card / CardPicker / SpreadLayout sections)
  layout.tsx                        metadataBase

src/auth/profile-actions.ts         setDefaultDeckAction, setUseReversalsAction
src/auth/routes.ts                  + '/decks'
src/config/env.ts, .env.example     NEXT_PUBLIC_SITE_URL
src/__tests__/rls/harness.ts        + expectPublicReadOnly(), hasPublicRows option
src/__tests__/invariants/thoth-never-substitutes-rws.test.tsx ★   live (placeholder .ts removed)
src/domain/privacy/deletionRegistry.ts   REFERENCE_TABLES (5) + spreads under `user`

scripts/build-card-art.ts ★         pnpm art:build — Commons download (backoff on 429) → sharp AVIF/WebP × 3 widths
scripts/seed-reference.ts           calls seedReferenceData()
public/cards/rws/ ★                 468 files (78 × {160,320,640} × {avif,webp}), 27 MB
docs/LICENSING.md ★                 what is bundled (RWS PD scans), what is not (Thoth), original text
e2e/decks.spec.ts ★                 7 tests × 2 projects
vitest.*.config.ts                  oxc automatic JSX runtime
```

## 4. Database changes

`0003_deck_reference.sql` (generated by `drizzle-kit generate --name deck_reference`, plain
additions so no TTY prompt; hand-written tail after the marker):

- Enums `alias_kind`, `arcana`, `art_strategy`.
- `decks` (10 cols, unique slug), `cards` (21 cols, unique `(deck_id, slug)`, index `(deck_id,
  sort_order)`), `card_archetypes` (unique key), `card_archetype_members` (unique `card_id`, index
  on `archetype_id`), `card_aliases` (unique `(card_id, alias)`), `spreads` (13 cols, partial unique
  indexes for built-in and per-user slugs). All RLS-enabled.
- Policies: `*_select` `using (true)` to `anon, authenticated` on the five reference tables;
  `spreads_select` (`user_id is null or user_id = auth.uid()`, anon + authenticated),
  `spreads_insert/update` (`user_id = auth.uid() and is_builtin = false`), `spreads_delete`.
- FK `profiles.default_deck_id → decks(id) on delete set null`.
- Hand-written: GIN trigram indexes `cards_name_trgm_idx`, `card_aliases_alias_trgm_idx`
  (`extensions.gin_trgm_ops`); `spreads_set_updated_at` trigger; table comments, including the
  "STRUCTURAL METADATA ONLY" comment on `card_archetypes`.

DATA_MODEL.md rewritten for this section (columns added: `title`, `suit_label`, `numeral`,
`card_count`, `sort_order`, `created_at`; `qabalah` folded into `correspondences`; layout shape;
RLS variants paragraph). Nothing else drifted.

## 5. AI tasks touched

None. No model call exists. Phase 04 will read `cards` rows (never archetypes) to ground
per-position interpretation and must keep Thoth prompts free of RWS vocabulary — the seed data now
gives it deck-native names, titles and correspondences to work from.

## 6. Thresholds and constants

| Constant | Where | Value |
|---|---|---|
| Search ranking | `src/domain/decks/search.ts` | name exact 100 · prefix 90 · token-prefix 80 · contains 70; title 95/85/78/65; alias 60/55/50/40; fuzzy Dice ≥ 0.45 → `round(sim·30)` when nothing else matched and query ≥ 4 chars |
| `MAX_RESULTS` | `card-picker.tsx` | 12 while typing (78 when browsing a chip) |
| `ART_WIDTHS` | `card.tsx` / `build-card-art.ts` | 160 · 320 · 640 px; AVIF q55 effort 6, WebP q78 effort 5 |
| Card aspect | `spread-layout.tsx`, `card.tsx` | 3:5 (0.6) |
| Card sizes | `card.tsx` | xs 48 · sm 72 · md 120 · lg 200 px; face font 0.5 / 0.66 / 0.95 / 1.45 rem |

No `thresholds.ts`; ALGORITHMS.md unchanged.

## 7. Tests added

| Suite | Files | What they prove |
|---|---|---|
| unit | `db/seed/__tests__/seed-integrity.test.ts` (21) | 78 cards per deck validating against the Zod schema; unique slugs/names; sort_order is a permutation of 0..77; every card has ≥ 3 keywords, > 120-char meaning, symbolism, correspondences; 22 majors 0–21, 4 suits × (10 pips + 4 courts); no predictive verbs; reversal text present iff the deck supports reversals. **Thoth authenticity:** court = Knight/Queen/Prince/Princess (no Page/King); earth suit = Disks (no `pentacles`); VIII Adjustment, XI Lust, XIV Art, XX The Aeon, XXI The Universe, I The Magus, II The Priestess, X Fortune; all 36 small-card titles in order, Aces untitled; majors carry Hebrew letter + path, pips sephira + decan, courts rulership + sub-element; **no Thoth meaning equals — or shares a sentence with — its archetype-mapped RWS meaning**, no Thoth text uses Pentacles/Page of/King of/Rider/Waite, renamed trumps never mention their RWS name; text-only, no reversals, license note. Archetypes: 78 unique slots, every card in exactly one, labels never a card name, mapping notes on every mismatch. Aliases: real targets, unique, never a card's own name, never another card's name in the same deck, required equivalences both ways. Spreads: five, valid, every slot inside the canvas, prompts hedged. |
| unit | `db/seed/__tests__/search-with-seed.test.ts` (11) | "Strength" → Thoth Lust via alias labeled Lust/Thoth; across decks RWS Strength first, Thoth Nine of Wands ("Strength" title) honestly labeled; "Pentacles" → only Disks cards; "Page of Pentacles" → Princess of Disks, never a Page; partial/prefix ("kni cu", "prin sw"); numbers ("3", "3 cups", "viii", "8"); Thoth titles ("Dominion", "ruin"); both-direction cross-deck names; typos via fuzzy; empty query |
| unit (invariant) | `__tests__/invariants/thoth-never-substitutes-rws.test.tsx` (10) | see below |
| unit | `db/__tests__/deletion-registry.test.ts` (updated) | registry now covers `spreads`; reference tables exempt |
| integration | `db/seed/__tests__/reference.integration.test.ts` (5) | row counts (2/156/78/156/5, > 100 aliases); **second seed run leaves an md5 digest of every row and id unchanged**; anon reads both decks through the query layer (Thoth: 14 Disks, no Page, Lust with null reversed, alias Strength, Teth, neighbours Fortune/The Hanged Man); DB-backed search; `default_deck_id` FK accepts a deck id and rejects a random uuid |
| rls | `db/__tests__/deck-reference.rls.test.ts` (5) | `decks`, `cards`, `card_archetypes`, `card_archetype_members`, `card_aliases`: A and anon **can** read, cannot insert/update/delete (row unchanged); anon reads only built-in spreads; a user cannot insert an `is_builtin` row; custom spreads pass full isolation with `hasPublicRows` |
| e2e | `e2e/decks.spec.ts` (7 × 2) | browse both decks, open Strength (art, alt text) and Lust (typographic, `img` role "Lust — Thoth"); Thoth grid and detail pages contain no Pentacles/Page/King/Justice/Temperance/Strength/Rider/Waite (alias sentence excepted); dignity note shown; Princess of Disks detail; in-deck alias search labels Lust with *also "Strength"*; public card page: 200 for anon, `<h1>` in HTML, canonical, `<title>`, JSON-LD Article headline "Lust — Thoth", exactly one funnel CTA, RWS page references the 640 WebP; `/cards`, `/cards/rws-classic`, `/cards/thoth`, `/spreads`, `/spreads/celtic-cross-lite` 200 + axe; HowTo JSON-LD with 5 steps; AVIF served with the right content type; **CardPicker: 3 interactions counted (click, type, Enter) → "Picked Lust · Thoth", recent card in 2**; keyboard-only (Tab, type "3 cups", Enter; "ace" ↓ Enter → Ace of Cups); deck scoping (option names never Page/Pentacles; Knight of Wands stays first for "Knight of Wands"; chips say Disks not Pentacles); Profile default deck + reversals persist across reload and drive the `/decks` default tab; axe on every screen in both projects |
| e2e | `e2e/smoke.spec.ts` (updated) | `Thoth` button locator made exact (the gallery now has "Picker: Thoth") |

Invariant tests unskipped this phase:
- [x] `thoth-never-substitutes-rws.test.tsx` — (1) seed: renamed trumps/Disks/court never carry RWS
      names, no Thoth meaning or keyword set equals its structural RWS mate, no Thoth card points at
      artwork while every RWS card does; (2) source: `card.tsx`, `card-picker.tsx`,
      `spread-layout.tsx`, `queries/decks.ts`, `app/(app)/decks`, `app/(marketing)/cards`,
      `app/(marketing)/spreads` contain no `card_archetype|cardArchetype|archetype` reference in
      code, and the query module only ever selects from decks/cards/card_aliases/spreads;
      (3) render: `renderToStaticMarkup(<Card/>)` for Thoth Lust contains `aria-label="Lust — Thoth"`,
      no "Strength", no `<img>`; Princess of Disks / Two of Disks ("Change") render deck-natively;
      RWS Strength reversed renders its own art, `alt="Strength, reversed — Rider–Waite–Smith"`,
      `rotate-180` and a visible "Reversed" label; alt text is deck-native for all 156 cards;
      (4) aliases find but never rename.

## 8. Verification evidence

```
$ pnpm lint && pnpm typecheck
All matched files use Prettier code style!
check-deletion-registry: ok
$ tsc --noEmit

$ pnpm test
 Test Files  15 passed | 11 skipped (26)
      Tests  120 passed | 11 skipped (131)
 Test Files  5 passed (5)
      Tests  25 passed (25)

$ pnpm test:rls
 Test Files  5 passed (5)
      Tests  12 passed (12)

$ pnpm build && pnpm check:client-bundle
 ✓ Compiled successfully in 4.3s
├ ƒ /cards … ƒ /cards/[deck] … ƒ /cards/[deck]/[slug] … ƒ /decks … ƒ /spreads/[slug]
check-client-bundle: ok (53 files scanned)

$ pnpm test:e2e            (mobile 390×844 + desktop; four consecutive runs)
  72 passed (31.3s) · 72 passed (32.5s) · 72 passed (30.7s) · 72 passed (30.7s)

$ pnpm db:seed && pnpm db:seed
reference data seeded: 2 decks · 156 cards · 78 archetypes · 156 members · 161 aliases · 5 spreads
reference data seeded: 2 decks · 156 cards · 78 archetypes · 156 members · 161 aliases · 5 spreads

$ pnpm art:build
card art ready: 78 cards × 3 widths × 2 formats in public/cards/rws
```

Database spot-check (psql in the Supabase container):
```
 rws-classic | 78 cards | 0 null reversed  | sort 0..77
 thoth       | 78 cards | 78 null reversed | sort 0..77
 alias "Strength"         → Lust (thoth)
 alias "Two of Pentacles" → Two of Disks (thoth)
 card_archetypes comment: STRUCTURAL METADATA ONLY (§6.7) …
```

| Metric | Target | Measured |
|---|---|---|
| Interactions to pick a card (CardPicker) | ≤ 3 | 3 (focus, type, Enter) — `interactions-per-card` annotation; 2 for a recent card |
| Cards per deck | 78 | 78 / 78 |
| Seed idempotency | no change on 2nd run | identical md5 digest + counts + ids |
| RWS art payload per card | small | 160w 8/12 kB · 320w 25/39 kB · 640w 88/141 kB (avif/webp) |
| Unit suite | fast | 2.4 s |
| Integration / RLS | — | 5.1 s / 4.6 s |
| E2E (72 tests, 2 projects) | — | ~31 s |

Manual checks actually performed:
- [x] **Visual, side by side at 390px, light and dark** (screenshots reviewed): RWS Strength art
      next to Thoth Lust typographic — the Thoth face reads as an intentional design (radial
      accent-soft ground, double hairline frame, numeral, serif name, Teth top-right, fire sigil
      and Leo glyph bottom, esoteric title at `lg`), not as a missing image. Two of Disks shows
      the disk glyph, "Two of Disks", *Change* in italic violet, ♃♑ glyphs. Reversed Tower rotates
      and carries the "REVERSED" chip. Three rounds of adjustment: em-scaled type per size, corner
      marks no longer collide with the frame (percent insets fixed to width-relative), `xs` no
      longer doubles the numeral.
- [x] `/cards/thoth/lust` at 390px light + dark: breadcrumb, large card, eyebrow "THOTH · MAJOR
      ARCANA XI", keywords, "Meaning" (not "Upright") and the dignity note under "Reversed".
- [x] Thoth public grid at 390px dark: 3 columns, deck-native names and titles under each card,
      chips read All / Major / Wands / Cups / Swords / **Disks**.
- [x] CardPicker at 390px dark, Thoth, query "str": Five of Wands (*Strife*), Nine of Wands
      (*Strength* title), Lust (*also "Strength"*) — each under its own name.
- [x] SpreadLayout: Celtic-cross-lite with cards (crossing card rotated 90° with counter-rotated
      badge), one-card, three-card, situation–advice–outcome, decision — all inside the canvas at
      390px with the numbered legend readable.
- [x] Keyboard-only picker path asserted in e2e (Tab to input, type, arrows, Enter).
- [x] Profile: default deck select and reversals switch persist across reload; description
      names the deck that never uses reversals.

## 9. UX notes

States: `Card` has a skeleton (`loading`) that keeps the footprint; the picker has an honest
empty state that names the deck ("No card in Thoth matches …") and a polite live region with the
result count; grids announce counts. Reversal is never colour/rotation alone. The typographic face
scales in em from one per-size font size and simplifies at `xs` (glyph + rank only). Deck accent
follows the card (`data-deck` on the figure) so a Thoth card in an RWS context is still violet.

Design system extended with `Card`, `CardPicker`, `SpreadLayout`, `CardDetail`, `DeckBrowser`
and the `MarketingShell` (one funnel line, no secondary nav). Copy on reference pages is
reflective ("suggests", "one way to read it"); a unit test bans predictive verbs.

Rough edges left deliberately: the in-app deck switch is a full navigation (link with `?deck=`),
so switching deck reloads the grid — fine for a reference page, and Phase 03 will do the live
switch inside the reading flow; the picker's chip row shows five deck-native chips and wraps to
two lines at 390px; `DeckBrowser` cards are rendered at `sm` type inside ~100 px tiles, which is
legible but small for long Thoth titles.

## 10. Deferred / not done

| Item | Reason | Moved to |
|---|---|---|
| Server-side card search (`pg_trgm` RPC) | Not needed: 78-card decks are searched in memory; trigram indexes exist for Phase 05 journal search | 05 (if cross-deck search over history needs SQL) |
| `fixtures/decks/` JSON fixtures | Deck-purity tests use the pure seed modules directly; recorded interpretation fixtures belong with the first AI task | 04 |
| Thoth commissioned/licensed art | Rights not available; schema and renderer are ready (`art_asset_path`, `original_commissioned`) | open question in PROGRESS.md |
| Live deck switch without navigation | Reference page uses links; the reading flow is where instant switching matters | 03 |
| PWA install on a physical phone | No device this session either | 03 (as already recorded) |

## 11. Known issues and risks

- Wikimedia Commons' upload host rate-limits after ~70 files (`429`, `retry-after: 600`). The
  art script backs off, pauses 750 ms between files and resumes from the gitignored cache, but a
  cold `pnpm art:build` on a new machine may need two runs ten minutes apart. Outputs are committed
  precisely so nobody has to run it.
- `public/cards/rws` adds 27 MB to the repository. Acceptable for 468 static assets; if it becomes
  a problem the pipeline can target Supabase Storage instead (paths are a prefix in
  `art_asset_path`).
- The typographic face uses Unicode planet/zodiac glyphs with the text-presentation selector;
  every tested font renders them, but an exotic system font could fall back to emoji glyphs.
  Element and suit marks are inline SVG and immune to this.
- The e2e Profile spec waits on the server-rendered description before reloading; the optimistic
  switch alone is not proof of persistence (found on desktop, where reload out-raced the write).
- `expectPublicReadOnly` picks "an existing row" per table; on `card_archetype_members` it tries
  to update `mapping_note` on whichever row comes first — fine, but do not reuse it on tables where
  the first row could legitimately be user-owned.
- axe: the `role="img"` typographic face hides its internal text from the accessibility tree by
  design (the label carries the name); if a future screen relies on reading the title *from* the
  card, add it to `cardAltText`.

## 12. How to verify this phase from scratch

```bash
pnpm install && cp .env.example .env.local
pnpm supabase:start && pnpm supabase:status     # paste ANON_KEY / SERVICE_ROLE_KEY into .env.local
pnpm db:migrate && pnpm db:seed && pnpm db:seed # second run prints identical counts
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm build && pnpm check:client-bundle && pnpm test:e2e
pnpm dev
```
1. Signed out: open `/cards` → Thoth → *Lust*. Title, canonical and JSON-LD are in view-source;
   the page says "read by elemental dignity … rather than by reversal". Open `/cards/rws-classic/strength`
   (art) and `/spreads/celtic-cross-lite`.
2. Sign in as `demo-ben@tarot.local` / `demo-password-123` → Home → "Browse the decks". Switch
   to Thoth; search "Strength" → Lust with *also "Strength"*; search "Page of Pentacles" → Princess
   of Disks. Open a card in each deck.
3. `/dev/ui` at 390px: Card section (art vs typographic, reversed Tower, sizes, skeleton); switch
   the picker to Thoth, type `lust`, press Enter → "Picked Lust · Thoth"; toggle chips; tab through
   the SpreadLayout slots.
4. `/profile`: set default deck to Thoth, switch reversals off, reload; `/decks` now opens on Thoth.

## 13. Notes for the next phase

- Read deck data through `src/db/queries/decks.ts`; `listCards(client, deck)` returns
  `PickerCard[]` (CardView + aliases) — the shape `CardPicker`, `DeckBrowser` and `searchCards`
  expect. **Never join the archetype tables in a render path**; when you add reading routes, add
  them to `RENDER_PATHS` in `thoth-never-substitutes-rws.test.tsx`.
- Effective reversals for a reading: `deck.supports_reversals && profile.use_reversals`. Thoth is
  `false` with null `meaning_reversed`; the draw engine must never mark a Thoth card reversed.
- `Card` sets `data-deck` on itself; set it on the reading page root too so chrome follows the
  chosen deck. `cardAltText()` is the one place alt/aria text is built.
- `SpreadLayout` takes `positions` + `layout` straight from the `spreads` row; slot heights are
  `w · aspect / 0.6`. Use `renderSlot` for cards and `onSelect`/`activeIndex` for the entry flow.
- Custom spreads: `spreads` already accepts user rows (`user_id`, `is_builtin=false`); validate
  with `spreadSeedSchema`-shaped Zod (positions + layout) before insert.
- `createReadyUser()` users have `default_deck_id = null`; `/decks` and the reading flow should
  treat null as "first deck by sort_order" (RWS), which is what `DecksPage` does.
- Vitest can render server components with `react-dom/server` (oxc automatic JSX is configured);
  use it for markup invariants before reaching for jsdom.
- These notes are now in the Phase 03 file.
