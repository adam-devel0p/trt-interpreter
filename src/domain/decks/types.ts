/**
 * Deck reference types (docs/DATA_MODEL.md#deck-reference-layer--phase-02). Pure: shared by the
 * seed modules, the seed-integrity tests and the UI. Card identity is deck-native (§6.7) —
 * nothing here assumes RWS vocabulary.
 */
import { z } from 'zod';

export const DECK_SYSTEMS = ['rws', 'thoth'] as const;
export type DeckSystem = (typeof DECK_SYSTEMS)[number];

export const ARCANA = ['major', 'minor'] as const;
export type Arcana = (typeof ARCANA)[number];

/** Machine suit keys. `pentacles` is RWS, `disks` is Thoth — they are different keys on purpose. */
export const SUITS = ['wands', 'cups', 'swords', 'pentacles', 'disks'] as const;
export type Suit = (typeof SUITS)[number];

export const ELEMENTS = ['fire', 'water', 'air', 'earth', 'spirit'] as const;
export type Element = (typeof ELEMENTS)[number];

export const ART_STRATEGIES = [
  'bundled_public_domain',
  'original_commissioned',
  'text_only',
] as const;
export type ArtStrategy = (typeof ART_STRATEGIES)[number];

export const ALIAS_KINDS = ['search', 'cross_deck', 'historical'] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];

/** Typed keys for `cards.correspondences`. Every key optional; decks fill what their system uses. */
export const correspondencesSchema = z
  .object({
    element: z.enum(ELEMENTS).optional(),
    /** Court cards: the sub-element (e.g. Queen = water of the suit's element). */
    sub_element: z.enum(ELEMENTS).optional(),
    planet: z.string().optional(),
    zodiac: z.string().optional(),
    /** Small cards: "Mars in Aries · 1st decan (0°–10°)". */
    decan: z.string().optional(),
    /** Court cards: the span of the zodiac the card rules ("20° Scorpio – 20° Sagittarius"). */
    rulership: z.string().optional(),
    sephira: z.string().optional(),
    /** Tree of Life path number (Majors), 11–32. */
    path: z.number().int().min(11).max(32).optional(),
    hebrew_letter: z.string().optional(),
    hebrew_letter_meaning: z.string().optional(),
    /** Golden Dawn / Thoth "Lord of …" title for small cards. */
    esoteric_title: z.string().optional(),
    numerology: z.number().int().min(0).max(21).optional(),
    notes: z.string().optional(),
  })
  .strict();
export type Correspondences = z.infer<typeof correspondencesSchema>;

export const cardSeedSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    title: z.string().min(1).nullable(),
    arcana: z.enum(ARCANA),
    suit: z.enum(SUITS).nullable(),
    suit_label: z.string().min(1).nullable(),
    rank_label: z.string().min(1).nullable(),
    number: z.number().int().min(0).max(21).nullable(),
    numeral: z.string().nullable(),
    element: z.enum(ELEMENTS).nullable(),
    astrology: z.string().min(1).nullable(),
    keywords_upright: z.array(z.string().min(1)).min(3),
    keywords_reversed: z.array(z.string().min(1)),
    meaning_upright: z.string().min(120),
    meaning_reversed: z.string().min(60).nullable(),
    symbolism: z.string().min(60),
    correspondences: correspondencesSchema,
    art_asset_path: z.string().nullable(),
    sort_order: z.number().int().min(0).max(77),
  })
  .strict();
export type CardSeed = z.infer<typeof cardSeedSchema>;

export const deckSeedSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    system: z.enum(DECK_SYSTEMS),
    tradition_notes: z.string().min(40),
    supports_reversals: z.boolean(),
    art_strategy: z.enum(ART_STRATEGIES),
    license_note: z.string().min(40),
    sort_order: z.number().int(),
    cards: z.array(cardSeedSchema).length(78),
  })
  .strict();
export type DeckSeed = z.infer<typeof deckSeedSchema>;

/** A spread position: the `prompt` grounds per-position interpretation later (§6.2). */
export const spreadPositionSchema = z
  .object({
    index: z.number().int().min(0),
    key: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    prompt: z.string().min(20),
  })
  .strict();
export type SpreadPosition = z.infer<typeof spreadPositionSchema>;

/**
 * Layout in relative units: `x`,`y` are the slot centre as a fraction of the canvas, `w` the
 * card width as a fraction of canvas width, `aspect` the canvas width/height ratio. `rotate`
 * (degrees) is for crossing cards. Renderers scale this to any viewport, 390px included.
 */
export const spreadLayoutSchema = z
  .object({
    aspect: z.number().positive(),
    slots: z.array(
      z
        .object({
          index: z.number().int().min(0),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().positive().max(1),
          rotate: z.number().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type SpreadLayout = z.infer<typeof spreadLayoutSchema>;

export const spreadSeedSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    description: z.string().min(20),
    positions: z.array(spreadPositionSchema).min(1),
    layout: spreadLayoutSchema,
    deck_scope: z.enum(DECK_SYSTEMS).nullable(),
    sort_order: z.number().int(),
  })
  .strict()
  .refine((s) => s.layout.slots.length === s.positions.length, 'one slot per position')
  .refine(
    (s) =>
      s.positions.every((p, i) => p.index === i) && s.layout.slots.every((p, i) => p.index === i),
    'positions and slots are indexed 0..n-1 in order',
  );
export type SpreadSeed = z.infer<typeof spreadSeedSchema>;

/** The shape components render from (a `cards` row joined with its deck's system). */
export interface CardView {
  id: string;
  deck_id: string;
  deck_system: DeckSystem;
  deck_name: string;
  slug: string;
  name: string;
  title: string | null;
  arcana: Arcana;
  suit: Suit | null;
  suit_label: string | null;
  rank_label: string | null;
  number: number | null;
  numeral: string | null;
  element: Element | null;
  astrology: string | null;
  correspondences: Correspondences;
  art_asset_path: string | null;
  sort_order: number;
}
