import type { AliasKind, DeckSystem } from '@/domain/decks/types';
import { PIP_WORDS } from './_builders';

/**
 * Search aliases (FR-03C). An alias makes a card *findable* by another name; it never changes
 * what the card is called. Search results are labeled with the card's actual deck and name.
 *
 * - `cross_deck`: the structurally corresponding card's name in the other deck (Strength → Lust).
 * - `search`: common spellings and suit synonyms (Judgment, Coins, Rods, Discs).
 */
export interface AliasSeed {
  deck: DeckSystem;
  card_slug: string;
  alias: string;
  kind: AliasKind;
  note: string | null;
}

const a = (
  deck: DeckSystem,
  card_slug: string,
  alias: string,
  kind: AliasKind,
  note: string | null = null,
): AliasSeed => ({ deck, card_slug, alias, kind, note });

const X =
  'Cross-deck equivalence is structural, not interpretive: the card keeps its own name and meaning.';

const MAJOR_PAIRS: [rwsSlug: string, rwsName: string, thothSlug: string, thothName: string][] = [
  ['the-magician', 'The Magician', 'the-magus', 'The Magus'],
  ['the-high-priestess', 'The High Priestess', 'the-priestess', 'The Priestess'],
  ['strength', 'Strength', 'lust', 'Lust'],
  ['wheel-of-fortune', 'Wheel of Fortune', 'fortune', 'Fortune'],
  ['justice', 'Justice', 'adjustment', 'Adjustment'],
  ['temperance', 'Temperance', 'art', 'Art'],
  ['judgement', 'Judgement', 'the-aeon', 'The Aeon'],
  ['the-world', 'The World', 'the-universe', 'The Universe'],
];

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const rankWord = (n: number) => PIP_WORDS[n]!;

function suitAliases(): AliasSeed[] {
  const out: AliasSeed[] = [];
  const earthRws = ['Page', 'Knight', 'Queen', 'King'];
  const earthThoth = ['Princess', 'Prince', 'Queen', 'Knight'];
  for (const n of RANKS) {
    const w = rankWord(n);
    // RWS Pentacles ← Disks / Coins ; Thoth Disks ← Pentacles / Coins / Discs
    out.push(
      a('rws', `${w.toLowerCase()}-of-pentacles`, `${w} of Disks`, 'cross_deck', X),
      a('rws', `${w.toLowerCase()}-of-pentacles`, `${w} of Coins`, 'search'),
      a('thoth', `${w.toLowerCase()}-of-disks`, `${w} of Pentacles`, 'cross_deck', X),
      a('thoth', `${w.toLowerCase()}-of-disks`, `${w} of Coins`, 'search'),
      a('thoth', `${w.toLowerCase()}-of-disks`, `${w} of Discs`, 'search'),
    );
    // Wands ← Rods / Staves, both decks
    for (const deck of ['rws', 'thoth'] as const) {
      out.push(
        a(deck, `${w.toLowerCase()}-of-wands`, `${w} of Rods`, 'search'),
        a(deck, `${w.toLowerCase()}-of-wands`, `${w} of Staves`, 'search'),
      );
    }
  }
  for (const rank of earthRws) {
    out.push(
      a('rws', `${rank.toLowerCase()}-of-pentacles`, `${rank} of Disks`, 'cross_deck', X),
      a('rws', `${rank.toLowerCase()}-of-pentacles`, `${rank} of Coins`, 'search'),
    );
  }
  for (const rank of earthThoth) {
    out.push(
      a('thoth', `${rank.toLowerCase()}-of-disks`, `${rank} of Pentacles`, 'cross_deck', X),
      a('thoth', `${rank.toLowerCase()}-of-disks`, `${rank} of Coins`, 'search'),
      a('thoth', `${rank.toLowerCase()}-of-disks`, `${rank} of Discs`, 'search'),
    );
  }
  return out;
}

/**
 * Court aliases use only rank words that exist in one deck (Page/King → RWS, Princess/Prince →
 * Thoth), so a deck-scoped search for "Knight" never surfaces a different card under that name.
 */
function courtAliases(): AliasSeed[] {
  const out: AliasSeed[] = [];
  const suits: [rws: string, thoth: string][] = [
    ['Wands', 'Wands'],
    ['Cups', 'Cups'],
    ['Swords', 'Swords'],
    ['Pentacles', 'Disks'],
  ];
  for (const [rs, ts] of suits) {
    const note = X;
    // Thoth Princess ← "Page of …"; Thoth Knight ← "King of …"
    out.push(
      a('thoth', `princess-of-${ts.toLowerCase()}`, `Page of ${rs}`, 'cross_deck', note),
      a('thoth', `knight-of-${ts.toLowerCase()}`, `King of ${rs}`, 'cross_deck', note),
    );
    if (rs !== ts) {
      out.push(
        a('thoth', `princess-of-${ts.toLowerCase()}`, `Page of ${ts}`, 'cross_deck', note),
        a('thoth', `knight-of-${ts.toLowerCase()}`, `King of ${ts}`, 'cross_deck', note),
        a('thoth', `prince-of-${ts.toLowerCase()}`, `Prince of ${rs}`, 'search'),
        a('thoth', `queen-of-${ts.toLowerCase()}`, `Queen of ${rs}`, 'search'),
      );
    }
    // RWS Page ← "Princess of …"; RWS Knight ← "Prince of …"
    out.push(
      a('rws', `page-of-${rs.toLowerCase()}`, `Princess of ${ts}`, 'cross_deck', note),
      a('rws', `knight-of-${rs.toLowerCase()}`, `Prince of ${ts}`, 'cross_deck', note),
    );
    if (rs !== ts) {
      out.push(
        a('rws', `page-of-${rs.toLowerCase()}`, `Princess of ${rs}`, 'cross_deck', note),
        a('rws', `knight-of-${rs.toLowerCase()}`, `Prince of ${rs}`, 'cross_deck', note),
        a('rws', `queen-of-${rs.toLowerCase()}`, `Queen of ${ts}`, 'search'),
        a('rws', `king-of-${rs.toLowerCase()}`, `King of ${ts}`, 'search'),
      );
    }
  }
  return out;
}

/** Deduplicated by (deck, card, alias): the first definition wins. */
export const ALIASES: AliasSeed[] = dedupe([
  ...MAJOR_PAIRS.flatMap(([rs, rn, ts, tn]) => [
    a('rws', rs, tn, 'cross_deck', X),
    a('thoth', ts, rn, 'cross_deck', X),
  ]),
  // Common spellings
  a('rws', 'judgement', 'Judgment', 'search'),
  a('rws', 'judgement', 'The Last Judgement', 'search'),
  a('thoth', 'the-aeon', 'Judgment', 'cross_deck', X),
  a('thoth', 'the-aeon', 'The Æon', 'search'),
  a('thoth', 'the-aeon', 'Aeon', 'search'),
  a('rws', 'the-high-priestess', 'Priestess', 'search'),
  a('rws', 'the-high-priestess', 'The Papess', 'historical', 'Older Marseille-derived name.'),
  a('rws', 'the-hierophant', 'The Pope', 'historical', 'Older Marseille-derived name.'),
  a('thoth', 'the-hierophant', 'The Pope', 'historical', 'Older Marseille-derived name.'),
  a('rws', 'wheel-of-fortune', 'The Wheel', 'search'),
  a('thoth', 'fortune', 'The Wheel', 'search'),
  a('thoth', 'fortune', 'Wheel', 'search'),
  a('rws', 'the-magician', 'The Juggler', 'historical', 'Older Marseille-derived name.'),
  a('thoth', 'the-magus', 'The Juggler', 'historical', 'Older Marseille-derived name.'),
  a('thoth', 'the-magus', 'Magician', 'cross_deck', X),
  ...suitAliases(),
  ...courtAliases(),
]);

function dedupe(list: AliasSeed[]): AliasSeed[] {
  const seen = new Set<string>();
  return list.filter((al) => {
    const k = `${al.deck}/${al.card_slug}/${al.alias.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
