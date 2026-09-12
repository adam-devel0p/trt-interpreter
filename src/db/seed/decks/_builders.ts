import type { CardSeed, Correspondences, Element, Suit } from '@/domain/decks/types';

/**
 * Small builders so each deck file reads as content, not plumbing. Every builder returns a
 * complete `CardSeed`; the deck module validates the whole array against `deckSeedSchema`.
 */

export const ROMAN = [
  '0',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
  'XXI',
] as const;

export const PIP_WORDS = [
  '',
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
] as const;

export const SUIT_ELEMENT: Record<Suit, Element> = {
  wands: 'fire',
  cups: 'water',
  swords: 'air',
  pentacles: 'earth',
  disks: 'earth',
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface Text {
  up: string[];
  rev: string[];
  meaning: string;
  reversed: string | null;
  symbolism: string;
}

export interface MajorInput extends Text {
  number: number;
  name: string;
  element: Element | null;
  astrology: string;
  correspondences: Correspondences;
  title?: string | null;
  art?: string | null;
}

export function major(i: MajorInput): CardSeed {
  return {
    slug: slugify(i.name),
    name: i.name,
    title: i.title ?? null,
    arcana: 'major',
    suit: null,
    suit_label: null,
    rank_label: null,
    number: i.number,
    numeral: ROMAN[i.number] ?? String(i.number),
    element: i.element,
    astrology: i.astrology,
    keywords_upright: i.up,
    keywords_reversed: i.rev,
    meaning_upright: i.meaning,
    meaning_reversed: i.reversed,
    symbolism: i.symbolism,
    correspondences: { ...i.correspondences, numerology: i.number },
    art_asset_path: i.art ?? null,
    sort_order: i.number,
  };
}

export interface PipInput extends Text {
  suit: Suit;
  suitLabel: string;
  number: number;
  /** Deck-native title (Thoth "Dominion"); null for RWS. */
  title?: string | null;
  astrology: string;
  correspondences: Correspondences;
  art?: string | null;
  /** Sort offset of this suit block (22 + 14 * suitIndex). */
  base: number;
}

export function pip(i: PipInput): CardSeed {
  const word = PIP_WORDS[i.number] ?? String(i.number);
  const name = `${word} of ${i.suitLabel}`;
  return {
    slug: slugify(name),
    name,
    title: i.title ?? null,
    arcana: 'minor',
    suit: i.suit,
    suit_label: i.suitLabel,
    rank_label: null,
    number: i.number,
    numeral: null,
    element: SUIT_ELEMENT[i.suit],
    astrology: i.astrology,
    keywords_upright: i.up,
    keywords_reversed: i.rev,
    meaning_upright: i.meaning,
    meaning_reversed: i.reversed,
    symbolism: i.symbolism,
    correspondences: { element: SUIT_ELEMENT[i.suit], ...i.correspondences },
    art_asset_path: i.art ?? null,
    sort_order: i.base + i.number - 1,
  };
}

export interface CourtInput extends Text {
  suit: Suit;
  suitLabel: string;
  rank: string;
  /** 0-based rank position within the court (lowest first). */
  rankIndex: number;
  title?: string | null;
  astrology: string;
  correspondences: Correspondences;
  art?: string | null;
  base: number;
}

export function court(i: CourtInput): CardSeed {
  const name = `${i.rank} of ${i.suitLabel}`;
  return {
    slug: slugify(name),
    name,
    title: i.title ?? null,
    arcana: 'minor',
    suit: i.suit,
    suit_label: i.suitLabel,
    rank_label: i.rank,
    number: null,
    numeral: null,
    element: SUIT_ELEMENT[i.suit],
    astrology: i.astrology,
    keywords_upright: i.up,
    keywords_reversed: i.rev,
    meaning_upright: i.meaning,
    meaning_reversed: i.reversed,
    symbolism: i.symbolism,
    correspondences: { element: SUIT_ELEMENT[i.suit], ...i.correspondences },
    art_asset_path: i.art ?? null,
    sort_order: i.base + 10 + i.rankIndex,
  };
}
