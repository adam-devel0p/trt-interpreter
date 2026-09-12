# Artwork & content licensing

What is bundled, where it came from, and what is deliberately *not* bundled (spec §6.7 "Artwork
rights"). Update this file whenever an asset is added or removed.

## Bundled

### Rider–Waite–Smith card artwork — public domain

| | |
|---|---|
| Work | The 78 card illustrations drawn by **Pamela Colman Smith** for Arthur Edward Waite, first published December 1909 by William Rider & Son, London |
| Status | Public domain worldwide (published 1909; author died 1951; US publication before 1929) |
| Source scans | Wikimedia Commons, files `RWS_Tarot_NN_Name.jpg` (trumps) and `Wands01.jpg … Pents14.jpg` (small cards), fetched via `Special:FilePath` |
| Pipeline | `pnpm art:build` → `scripts/build-card-art.ts`: downloads originals into the gitignored `.cache/card-art/rws/`, then encodes each card to **AVIF (q55) and WebP (q78) at 160 / 320 / 640 px** wide |
| Location | `public/cards/rws/<slug>-<width>.<avif|webp>` — 78 × 3 × 2 = 468 files, ≈ 24 MB committed |
| Referenced from | `cards.art_asset_path = '/cards/rws/<slug>'`; the `Card` component builds the `<picture>` srcsets |
| Provenance in data | `decks.license_note` for `rws-classic` |

The scans are of the original "Pamela-A" printing. Modern recolourings published by U.S. Games
Systems are **not** used; nothing from any post-1923 edition is bundled.

## Deliberately not bundled

### Thoth card artwork — under copyright

Lady Frieda Harris's paintings (1938–1943, published 1944) are under copyright held by Ordo
Templi Orientis and the Harris estate. **No scans, thumbnails, tracings or derivative images of
Thoth cards are included anywhere in this repository or served by the application.**

Instead the Thoth deck ships with `art_strategy = 'text_only'` and is rendered by the designed
typographic treatment in `src/ui/components/card.tsx` (`TypographicFace`): deck-native name,
numeral, Thoth title, suit glyph, element sigil, Hebrew letter and astrological glyphs, in the
Thoth accent palette. This is a design choice, not a fallback: it must read as intentional next to
an RWS art card (checked in every phase review).

The schema leaves the door open: `cards.art_asset_path` is nullable and the renderer prefers art
when present, so licensed or commissioned per-card artwork can be added later without a schema
change (`art_strategy = 'original_commissioned'`).

### Card meanings and titles — original text

All card meanings, keywords, symbolism notes and spread prompts in `src/db/seed/decks/` are
original text written for this product. Thoth card **titles** (Dominion, Ruin, Lust, Art …),
Golden Dawn esoteric titles and astrological/Qabalistic attributions are traditional
correspondences in the public domain (Golden Dawn papers, 1888–1900; *The Book of Thoth*, 1944,
is quoted nowhere — the meanings paraphrase the system's framework in the product's own voice).

## Fonts

`@fontsource-variable/newsreader` and `@fontsource-variable/dm-sans` — SIL Open Font License 1.1,
self-hosted through the bundle.
