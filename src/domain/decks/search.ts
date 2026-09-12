/**
 * Deck-native card search (FR-03C). Pure and synchronous: the whole deck (78 cards + aliases)
 * is small enough to search in memory, which is what makes the picker fast and keyboard-first.
 *
 * A hit is always the card itself — its own deck, its own name. Aliases only make a card
 * findable ("Strength" finds Thoth *Lust*); they never rename it. `matched` tells the UI why
 * a row is there so it can show "also known as Strength" without ever displaying the alias as
 * the card's name.
 */

export interface SearchableAlias {
  alias: string;
  kind: 'search' | 'cross_deck' | 'historical';
}

export interface SearchableCard {
  id: string;
  name: string;
  title: string | null;
  arcana: 'major' | 'minor';
  suit: string | null;
  suit_label: string | null;
  rank_label: string | null;
  number: number | null;
  numeral: string | null;
  sort_order: number;
  aliases: SearchableAlias[];
}

export type MatchKind = 'name' | 'title' | 'alias' | 'fuzzy';

export interface SearchHit<T extends SearchableCard> {
  card: T;
  score: number;
  matched: MatchKind;
  /** The alias text that produced the hit, when `matched === 'alias'`. */
  via?: string;
}

const NUMBER_WORDS: Record<string, string> = {
  ace: '1',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'of']);

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map((t) => NUMBER_WORDS[t] ?? t);
}

/** Searchable token set for a card: name, digit form of its number, roman numeral, rank, suit. */
function cardTokens(c: SearchableCard): string[] {
  const out = tokens(c.name);
  if (c.number !== null) out.push(String(c.number));
  if (c.numeral) out.push(normalize(c.numeral));
  return [...new Set(out)];
}

/** Every query token is a prefix of some candidate token (order-free). */
function allTokensPrefix(query: string[], candidate: string[]): boolean {
  return query.every((q) => candidate.some((t) => t.startsWith(q)));
}

function scoreText(
  query: string,
  qTokens: string[],
  text: string,
  weights: [number, number, number, number],
) {
  const n = normalize(text);
  const nt = tokens(text);
  if (n === query) return weights[0];
  if (n.startsWith(query)) return weights[1];
  if (qTokens.length && allTokensPrefix(qTokens, nt)) return weights[2];
  if (n.includes(query)) return weights[3];
  return 0;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice bigram similarity, 0..1. Enough to forgive "strenght" and "pentacels". */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    total += n;
    overlap += Math.min(n, gb.get(g) ?? 0);
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

export interface SearchOptions {
  limit?: number;
  /** Minimum fuzzy similarity when nothing matches exactly. */
  fuzzyThreshold?: number;
}

export function searchCards<T extends SearchableCard>(
  cards: readonly T[],
  rawQuery: string,
  opts: SearchOptions = {},
): SearchHit<T>[] {
  const limit = opts.limit ?? 12;
  const query = normalize(rawQuery);
  if (!query) return [];
  const qTokens = tokens(rawQuery);
  const hits: SearchHit<T>[] = [];

  for (const card of cards) {
    let best: SearchHit<T> | null = null;
    const consider = (h: SearchHit<T>) => {
      if (h.score > 0 && (!best || h.score > best.score)) best = h;
    };

    // Name (and structural tokens: number, numeral). Highest priority.
    const ct = cardTokens(card);
    const n = normalize(card.name);
    if (n === query || ct.join(' ') === query) consider({ card, score: 100, matched: 'name' });
    else if (n.startsWith(query)) consider({ card, score: 90, matched: 'name' });
    else if (qTokens.length && allTokensPrefix(qTokens, ct))
      consider({ card, score: 80, matched: 'name' });
    else if (n.includes(query)) consider({ card, score: 70, matched: 'name' });

    // Deck-native title (Thoth small cards).
    if (card.title) {
      const s = scoreText(query, qTokens, card.title, [95, 85, 78, 65]);
      if (s) consider({ card, score: s, matched: 'title' });
    }

    // Aliases: findable, never renamed.
    for (const al of card.aliases) {
      const s = scoreText(query, qTokens, al.alias, [60, 55, 50, 40]);
      if (s) consider({ card, score: s, matched: 'alias', via: al.alias });
    }

    if (best) hits.push(best);
  }

  if (hits.length === 0 && query.length >= 4) {
    const threshold = opts.fuzzyThreshold ?? 0.45;
    for (const card of cards) {
      const candidates = [card.name, card.title ?? '', ...card.aliases.map((a) => a.alias)];
      let sim = 0;
      for (const c of candidates) sim = Math.max(sim, similarity(query, normalize(c)));
      if (sim >= threshold) hits.push({ card, score: Math.round(sim * 30), matched: 'fuzzy' });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.card.sort_order - b.card.sort_order);
  return hits.slice(0, limit);
}
