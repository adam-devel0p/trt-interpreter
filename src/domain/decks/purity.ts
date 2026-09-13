/**
 * Deck-purity vocabulary and validator (spec §6.7, §19; invariant 3). Pure: the caller supplies
 * the two deck seeds, so this module needs neither the database nor the seed modules.
 *
 * Banned terms for a reading = the *other* deck's vocabulary (card names, suit and court labels,
 * the deck's own name) minus anything that is also legitimate in this deck. So a Thoth reading
 * may say "Knight" (both decks have one) and "Strength" (the Nine of Wands' title) but never
 * "Page", "Pentacles" or "Rider–Waite–Smith"; an RWS reading may never say "Disks", "Prince",
 * "Princess", "Lust" or "Thoth".
 *
 * Two deliberate limits keep prose readable: the other deck's small-card *titles* ("Change",
 * "Success", "Love") are ordinary words and are never banned, and single-word trump names
 * ("Justice", "Art", "Fortune") are matched case-sensitively, so "a sense of justice" passes
 * while "Justice" as a card reference fails.
 */
import type { DeckSystem } from './types';

export interface DeckVocabularyInput {
  system: DeckSystem;
  name: string;
  cards: readonly {
    name: string;
    title: string | null;
    suit_label: string | null;
    rank_label: string | null;
  }[];
}

/** Common ways the deck is referred to in prose, beyond `decks.name`. */
const DECK_ALIASES: Record<DeckSystem, readonly string[]> = {
  rws: ['Rider–Waite–Smith', 'Rider-Waite-Smith', 'Rider-Waite', 'Rider Waite', 'Waite-Smith'],
  thoth: ['Thoth', 'Crowley-Harris', 'Crowley'],
};

export interface BannedTerm {
  term: string;
  caseSensitive: boolean;
}

export interface DeckVocabulary {
  system: DeckSystem;
  /** Every term the deck legitimately uses, lower-cased (names, titles, suit and court labels). */
  own: Set<string>;
  /** What the other deck may not say: names, suit and court labels, deck names — not titles. */
  identifying: BannedTerm[];
}

export function deckVocabulary(deck: DeckVocabularyInput): DeckVocabulary {
  const own = new Set<string>();
  const identifying = new Map<string, BannedTerm>();
  const add = (s: string | null, identify: boolean) => {
    if (!s) return;
    own.add(s.toLowerCase());
    if (identify && !identifying.has(s.toLowerCase())) {
      identifying.set(s.toLowerCase(), { term: s, caseSensitive: !/\s/.test(s) });
    }
  };
  add(deck.name, true);
  for (const a of DECK_ALIASES[deck.system]) add(a, true);
  for (const c of deck.cards) {
    add(c.name, true);
    add(c.title, false);
    add(c.suit_label, true);
    add(c.rank_label, true);
  }
  // Suit and court labels are unambiguous card vocabulary even as single words.
  for (const c of deck.cards) {
    for (const s of [c.suit_label, c.rank_label]) {
      if (s) identifying.set(s.toLowerCase(), { term: s, caseSensitive: false });
    }
  }
  for (const a of [deck.name, ...DECK_ALIASES[deck.system]]) {
    identifying.set(a.toLowerCase(), { term: a, caseSensitive: false });
  }
  return { system: deck.system, own, identifying: [...identifying.values()] };
}

/** The terms an interpretation for `own` must never contain: `other`'s identifying vocabulary minus `own`'s. */
export function bannedTerms(own: DeckVocabulary, other: DeckVocabulary): BannedTerm[] {
  return other.identifying
    .filter((t) => !own.own.has(t.term.toLowerCase()))
    .sort((a, b) => b.term.length - a.term.length);
}

export interface PurityViolation {
  term: string;
  count: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[–-]/g, '[–-]');
}

/**
 * Whole-word scan of `text` for any banned term (case-insensitive unless the term says
 * otherwise). Returns the distinct terms found (longest first) with counts; empty means pure.
 */
export function findPurityViolations(
  text: string,
  banned: readonly (BannedTerm | string)[],
): PurityViolation[] {
  const found: PurityViolation[] = [];
  for (const b of banned) {
    const { term, caseSensitive } = typeof b === 'string' ? { term: b, caseSensitive: false } : b;
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      caseSensitive ? 'gu' : 'giu',
    );
    const count = (text.match(re) ?? []).length;
    if (count > 0) found.push({ term: term.toLowerCase(), count });
  }
  return found;
}

/** Convenience: build both vocabularies and scan in one call. */
export function checkDeckPurity(
  text: string,
  own: DeckVocabularyInput,
  other: DeckVocabularyInput,
): PurityViolation[] {
  return findPurityViolations(text, bannedTerms(deckVocabulary(own), deckVocabulary(other)));
}
