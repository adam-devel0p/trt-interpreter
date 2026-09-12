/**
 * Glyph lookups for the typographic card treatment. Text presentation (U+FE0E) is forced so
 * zodiac and planet signs never render as colour emoji. Pure; used by UI and tests.
 */
import type { Element } from './types';

const TEXT = '︎';

export const PLANET_GLYPH: Record<string, string> = {
  sun: `☉${TEXT}`,
  moon: `☽${TEXT}`,
  mercury: `☿${TEXT}`,
  venus: `♀${TEXT}`,
  mars: `♂${TEXT}`,
  jupiter: `♃${TEXT}`,
  saturn: `♄${TEXT}`,
  uranus: `♅${TEXT}`,
  neptune: `♆${TEXT}`,
  pluto: `♇${TEXT}`,
};

export const ZODIAC_GLYPH: Record<string, string> = {
  aries: `♈${TEXT}`,
  taurus: `♉${TEXT}`,
  gemini: `♊${TEXT}`,
  cancer: `♋${TEXT}`,
  leo: `♌${TEXT}`,
  virgo: `♍${TEXT}`,
  libra: `♎${TEXT}`,
  scorpio: `♏${TEXT}`,
  sagittarius: `♐${TEXT}`,
  capricorn: `♑${TEXT}`,
  aquarius: `♒${TEXT}`,
  pisces: `♓${TEXT}`,
};

/** Hebrew letter names as used in the Thoth correspondences → the letter itself. */
export const HEBREW_LETTER: Record<string, string> = {
  aleph: 'א',
  beth: 'ב',
  gimel: 'ג',
  daleth: 'ד',
  heh: 'ה',
  vau: 'ו',
  zain: 'ז',
  cheth: 'ח',
  teth: 'ט',
  yod: 'י',
  kaph: 'כ',
  lamed: 'ל',
  mem: 'מ',
  nun: 'נ',
  samekh: 'ס',
  ayin: 'ע',
  peh: 'פ',
  tzaddi: 'צ',
  qoph: 'ק',
  resh: 'ר',
  shin: 'ש',
  tau: 'ת',
};

/** "Mars in Aries", "The Moon", "Leo", "Saturn and Earth" → the glyphs found in the phrase. */
export function astrologyGlyphs(astrology: string | null | undefined): string[] {
  if (!astrology) return [];
  const words = astrology.toLowerCase().split(/[^a-z]+/);
  const out: string[] = [];
  for (const w of words) {
    const g = PLANET_GLYPH[w] ?? ZODIAC_GLYPH[w];
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

export function hebrewLetter(name: string | null | undefined): string | null {
  if (!name) return null;
  return HEBREW_LETTER[name.toLowerCase()] ?? null;
}

/** Alchemical element sigils as SVG path data on a 24×24 box (triangle up/down, barred). */
export const ELEMENT_SIGIL: Record<Element, { d: string; label: string }> = {
  fire: { d: 'M12 4 L20 19 L4 19 Z', label: 'fire' },
  water: { d: 'M12 20 L4 5 L20 5 Z', label: 'water' },
  air: { d: 'M12 4 L20 19 L4 19 Z M6.5 14 L17.5 14', label: 'air' },
  earth: { d: 'M12 20 L4 5 L20 5 Z M6.5 10 L17.5 10', label: 'earth' },
  spirit: {
    d: 'M12 3 L14.5 9.5 L21 9.5 L15.8 13.5 L17.8 20 L12 16 L6.2 20 L8.2 13.5 L3 9.5 L9.5 9.5 Z',
    label: 'spirit',
  },
};

/** Suit glyphs as SVG path data on a 24×24 box, drawn deck-neutrally (a disk is a disk). */
export const SUIT_GLYPH: Record<string, string> = {
  // A rod, budding: vertical staff with two small leaves.
  wands:
    'M12 3 V21 M12 8 C9.5 8 8 6.5 8 5 C10 5 11.5 6 12 8 Z M12 11 C14.5 11 16 9.5 16 8 C14 8 12.5 9 12 11 Z',
  // A chalice.
  cups: 'M6 4 H18 C18 9 15.5 12 12 12 C8.5 12 6 9 6 4 Z M12 12 V18 M8 20 H16',
  // A sword, point up.
  swords: 'M12 2 V19 M8 15 H16 M9.5 21 H14.5 M12 2 L10 6 M12 2 L14 6',
  // A pentacle: circle with a five-pointed star.
  pentacles:
    'M12 2 A10 10 0 1 0 12.01 2 Z M12 5 L14.2 11.2 L20.5 11.2 L15.4 15 L17.3 21 L12 17.3 L6.7 21 L8.6 15 L3.5 11.2 L9.8 11.2 Z',
  // A disk: circle with a central point and inner ring.
  disks:
    'M12 2 A10 10 0 1 0 12.01 2 Z M12 6 A6 6 0 1 0 12.01 6 Z M12 10.5 A1.5 1.5 0 1 0 12.01 10.5 Z',
};
