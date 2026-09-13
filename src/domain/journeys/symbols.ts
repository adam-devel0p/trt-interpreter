/**
 * Recurring symbols (spec §3.3, §6.5): cards, suits and themes that keep coming back in a
 * journey, each with context and its source readings — never a bare counter. Card identity
 * is deck-native (§6.7): a card recurs by its own id, a suit by (deck, suit), so Thoth *Lust*
 * and RWS *Strength* are two symbols, and Disks are not Pentacles. No archetype mapping is
 * consulted here or anywhere on a render path.
 */
import { RECURRENCE_MIN } from './thresholds';

export interface SymbolCard {
  cardId: string;
  name: string;
  /** Machine suit key; null for majors. */
  suit: string | null;
  suitLabel: string | null;
  positionName: string | null;
}

export interface SymbolObject {
  id: string;
  occurredAt: string;
  deckSystem: 'rws' | 'thoth';
  deckName: string;
  cards: readonly SymbolCard[];
  themes: readonly { slug: string; label: string }[];
}

export type SymbolKind = 'card' | 'suit' | 'theme';

export interface RecurringSymbol {
  kind: SymbolKind;
  key: string;
  label: string;
  /** Deck the symbol belongs to; null for themes (they may generalise across decks). */
  deck: { system: 'rws' | 'thoth'; name: string } | null;
  /** Objects it appeared in, newest first. */
  sourceObjectIds: string[];
  /** "Appeared in 3 readings between March and July, twice in the outcome position." */
  context: string;
}

const MONTH = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' });
const YEAR = (iso: string) => new Date(iso).getUTCFullYear();

function spanText(isos: string[]): string {
  const sorted = [...isos].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const a = YEAR(first) === YEAR(last) ? MONTH(first) : `${MONTH(first)} ${YEAR(first)}`;
  const b = YEAR(first) === YEAR(last) ? MONTH(last) : `${MONTH(last)} ${YEAR(last)}`;
  return a === b ? `in ${a}` : `between ${a} and ${b}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function recurringSymbols(
  objects: readonly SymbolObject[],
  opts: { min?: number } = {},
): RecurringSymbol[] {
  const min = opts.min ?? RECURRENCE_MIN;
  const total = objects.length;
  type Acc = {
    kind: SymbolKind;
    label: string;
    deck: RecurringSymbol['deck'];
    objects: Map<string, string>;
    positions: Map<string, number>;
  };
  const acc = new Map<string, Acc>();
  const touch = (
    key: string,
    init: () => Omit<Acc, 'objects' | 'positions'>,
    o: SymbolObject,
    pos?: string | null,
  ) => {
    const cur = acc.get(key) ?? { ...init(), objects: new Map(), positions: new Map() };
    cur.objects.set(o.id, o.occurredAt);
    if (pos) cur.positions.set(pos, (cur.positions.get(pos) ?? 0) + 1);
    acc.set(key, cur);
  };
  for (const o of objects) {
    const deck = { system: o.deckSystem, name: o.deckName };
    for (const c of o.cards) {
      touch(`card:${c.cardId}`, () => ({ kind: 'card', label: c.name, deck }), o, c.positionName);
      if (c.suit)
        touch(
          `suit:${o.deckSystem}:${c.suit}`,
          () => ({ kind: 'suit', label: c.suitLabel ?? c.suit!, deck }),
          o,
        );
    }
    for (const t of o.themes)
      touch(`theme:${t.slug}`, () => ({ kind: 'theme', label: t.label, deck: null }), o);
  }

  const out: RecurringSymbol[] = [];
  for (const [key, a] of acc) {
    if (a.objects.size < min) continue;
    const ids = [...a.objects].sort(([, x], [, y]) => (x < y ? 1 : -1)).map(([id]) => id);
    const isos = [...a.objects.values()];
    const of =
      a.kind === 'theme'
        ? `${total} ${total === 1 ? 'entry' : 'entries'}`
        : plural(total, 'reading');
    let context =
      a.kind === 'suit'
        ? `${a.label} cards turned up in ${a.objects.size} of ${of} ${spanText(isos)}`
        : a.kind === 'theme'
          ? `Came up in ${a.objects.size} of ${of} ${spanText(isos)}`
          : `Appeared in ${a.objects.size} of ${of} ${spanText(isos)}`;
    const repeated = [...a.positions].filter(([, n]) => n >= 2).sort(([, x], [, y]) => y - x)[0];
    if (a.kind === 'card' && repeated)
      context += `, ${repeated[1] === 2 ? 'twice' : `${repeated[1]} times`} in the ${repeated[0].toLowerCase()} position`;
    context += '.';
    out.push({ kind: a.kind, key, label: a.label, deck: a.deck, sourceObjectIds: ids, context });
  }
  // Cards first, then suits, then themes; within a kind the most recurrent first.
  const order: Record<SymbolKind, number> = { card: 0, suit: 1, theme: 2 };
  return out.sort(
    (x, y) =>
      order[x.kind] - order[y.kind] ||
      y.sourceObjectIds.length - x.sourceObjectIds.length ||
      x.label.localeCompare(y.label),
  );
}
