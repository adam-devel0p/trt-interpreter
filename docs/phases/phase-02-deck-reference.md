# Phase 02 — Deck Reference Layer: RWS + Thoth

**Deps:** 00 (01 optional) · **Spec:** §2, §6.7, FR-03A, FR-03B, FR-03C, §17, §19 · **Outcome:** both deck systems
exist as first-class, deck-native reference data — 156 cards with correct names, court structures,
meanings and correspondences — browsable in the app and on public reference pages, with cross-deck
search aliases that never rename history.

> This is the phase where the product's most distinctive technical claim is either done properly or
> permanently compromised. **Thoth is not a skin over RWS.** If you find yourself copying RWS meanings
> into Thoth rows, stop.

## Scope

**In:** `decks`, `cards`, `card_archetypes(+members)`, `card_aliases`, `spreads`; seed data for both
decks and 5 built-in spreads; art strategy implementation; `Card`/`CardPicker`/`SpreadLayout`
components; card reference browser in-app; public SEO reference pages.

**Out:** readings (03), AI interpretation (04), custom spread *creation UI* (03/05 — the schema
supports it now).

## Tasks

### 1. Schema and migration
Tables per [../DATA_MODEL.md](../DATA_MODEL.md#deck-reference-layer--phase-02). Reference tables are
world-readable to `authenticated` **and** `anon` (public pages), writable only by service role. Indexes
for `(deck_id, sort_order)`, trigram on `cards.name` and `card_aliases.alias`.

### 2. Deck seed data — the substance of this phase
`src/db/seed/decks/rws.ts` and `.../thoth.ts`, idempotent via `pnpm db:seed`.

**RWS (78):** standard Major Arcana names; suits Wands/Cups/Swords/Pentacles; court
**Page / Knight / Queen / King**; upright + reversed meanings, keywords, elemental and astrological
correspondences, symbolism notes.

**Thoth (78) — deck-native throughout:**
- Majors use Thoth names: **Adjustment** (VIII), **Lust** (XI), **Art** (XIV), **The Aeon** (XX),
  **The Universe** (XXI), plus *The Magus*, *The Priestess*, *The Hierophant*, *Fortune*, *The Hanged
  Man*, *Æon* terminology as the deck uses it.
- Suits: Wands/Cups/Swords/**Disks**.
- Court: **Knight / Queen / Prince / Princess** — structurally different from RWS, not a renaming.
- Small cards carry their Thoth titles (e.g. Two of Wands "Dominion", Ten of Swords "Ruin") because
  Thoth practice is title-led.
- Correspondences: element, astrological attribution (decan/planet-in-sign), Qabalistic sephira/path,
  Hebrew letter for Majors — stored in `correspondences jsonb` with typed keys.
- Reversal practice: Thoth users frequently do not use reversals. `decks.supports_reversals` plus a
  user preference disables them entirely for Thoth (§6.7). Reversed meaning may be null; the UI must
  handle null gracefully.
- **Write Thoth meanings from the Thoth system's own framework.** Any Thoth row whose meaning text is a
  copy of the RWS row for the same position is a defect; a seed-validation test checks for it.

### 3. Archetype mapping — metadata only
- `card_archetypes` (78 structural slots) + members from both decks.
- Used **only** for search, analytics and cross-deck aggregation. A DB comment, a doc comment and the
  invariant test `thoth-never-substitutes-rws.test.ts` all state that render paths must resolve names
  and meanings through `cards`, never through archetypes.
- Structural mismatches (Adjustment↔Justice, Lust↔Strength, Art↔Temperance, The Aeon↔Judgement,
  The Universe↔The World, Disks↔Pentacles, Prince/Princess↔Knight/Page) are mapped with a
  `mapping_note` explaining that correspondence is structural, not interpretive.

### 4. Search aliases (FR-03C)
- `card_aliases` seeded with cross-deck equivalences and common spellings, so searching "Strength"
  finds Thoth *Lust* and "Pentacles" finds *Disks*.
- Search returns results labeled with their **actual** deck and card name. No historical row is ever
  renamed. Test: searching an RWS term returns the Thoth card under its Thoth name.

### 5. Artwork strategy (§6.7 artwork rights)
- **RWS:** bundle the public-domain 1909 Pamela Colman Smith artwork; record provenance in
  `license_note`; optimise to AVIF/WebP at 2–3 sizes.
- **Thoth:** **do not ship scans.** Implement `art_strategy='text_only'` with a designed typographic
  card treatment: deck-native name, title, suit glyph, element/astrological sigils, and a distinctive
  Thoth accent palette. It must look deliberate and beautiful, not like a missing image — this is a
  design task, not a fallback. Leave the path open for commissioned art per card
  (`art_asset_path` nullable, renderer prefers art when present).
- A licensing note in `docs/` records exactly what is bundled, its provenance, and what is deliberately
  not bundled.

### 6. Spreads
Seed 5 built-in spreads with positions **and layout coordinates**: one-card, three-card
(Past/Present/Future), Situation–Advice–Outcome, Decision (two paths + centre), Celtic-cross-lite (5).
Each position carries a `prompt` string used later to ground interpretation per position (§6.2).
Schema already supports `user_id`-owned custom spreads for FR-05.

### 7. Components
- `Card`: renders art or typographic treatment, orientation-aware (rotated visual + explicit
  "Reversed" label — never colour/rotation alone), sizes xs→lg, meaningful alt text
  ("Lust, reversed — Thoth"), skeleton state.
- `CardPicker`: the speed-critical control for physical entry. Search by name, title, number, suit and
  alias; keyboard-first; recent/most-used first; suit and Major/Minor filter chips; **reachable in ≤ 3
  interactions per card**. Respects the active deck — a Thoth reading never offers "Page of Pentacles".
- `SpreadLayout`: renders positions from layout coordinates, responsive at 390px, position names
  always visible or one tap away.

### 8. Reference surfaces
- In-app `/(app)/decks`: deck switcher, card grid, card detail (name, title, meanings, correspondences,
  symbolism) — no AI, purely reference (§17 MVP reference layer).
- Public `/(marketing)/cards/[deck]/[slug]` and `/spreads/[slug]`: server-rendered, metadata +
  canonical URLs + JSON-LD, one contextual funnel line into journaling and nothing more (§15.1 —
  reference pages must not become the product).

## Test plan

- [ ] Seed integrity: exactly 78 cards per deck; unique slugs; every card has keywords, a meaning and
      correspondences; `pnpm db:seed` twice changes nothing (idempotent).
- [ ] **Thoth authenticity suite:** court ranks are Knight/Queen/Prince/Princess; suit is Disks;
      VIII=Adjustment, XI=Lust, XIV=Art, XX=The Aeon, XXI=The Universe; small cards carry Thoth titles;
      **no Thoth `meaning_upright` equals its archetype-mapped RWS `meaning_upright`.**
- [ ] Archetype mapping: every card belongs to exactly one archetype; mapping is never used by a render
      path (assert via a spy or a source-level check on the renderer's query).
- [ ] Alias search: "Strength" → Thoth *Lust* labeled as Lust/Thoth; "Pentacles" → *Disks*;
      no result is renamed.
- [ ] `CardPicker`: fuzzy/partial/number search; ≤ 3 interactions to pick a card (measured in the E2E
      spec); keyboard-only selection; deck scoping enforced.
- [ ] Reversal handling: `supports_reversals=false` path renders and reads correctly with null
      reversed meanings.
- [ ] E2E: browse both decks, open a card in each, confirm Thoth detail shows zero RWS terminology;
      public card page renders for anon with correct metadata. axe clean, 390px.
- [ ] Visual: Thoth typographic treatment reviewed side by side with an RWS art card — it must read as
      an intentional design choice.

## Exit criteria

- [ ] 156 cards seeded, deck-native, verified by the authenticity suite.
- [ ] 5 spreads with positions, prompts and layouts.
- [ ] Cross-deck aliases work; nothing is ever renamed.
- [ ] Thoth typographic treatment implemented and reviewed; licensing note written.
- [ ] `Card` / `CardPicker` / `SpreadLayout` in `/dev/ui`, both themes, a11y clean.
- [ ] Public reference pages render server-side for anon users.
- [ ] Invariant test `thoth-never-substitutes-rws.test.ts` **unskipped and passing**.
- [ ] Report + `../PROGRESS.md`; `../DATA_MODEL.md` updated if the schema drifted.
