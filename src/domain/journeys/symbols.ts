/**
 * Recurring symbols (spec §3.3, §6.5, FR-17): cards, suits and themes that keep coming back,
 * each with context and its source readings — never a bare counter. Card identity is
 * deck-native (§6.7): a card recurs by its own id, a suit by (deck, suit), so Thoth *Lust*
 * and RWS *Strength* are two symbols, and Disks are not Pentacles. No archetype mapping is
 * consulted here or anywhere on a render path.
 *
 * Phase 10 (v2, "not merely statistics"): every symbol carries *when* it appeared (the
 * occurrences, in order, for a sparse timeline), around which journeys, before or after
 * which confirmed life events, and whether the user confirmed a connection between one of
 * its readings and such an event. A symbol is only *called a pattern* from
 * `PATTERN_MIN_OCCURRENCES` distinct readings; two appearances are listed as two
 * appearances (§3.3 honesty), never as a pattern.
 */
import { PATTERN_EVENT_WINDOW_DAYS, PATTERN_MIN_OCCURRENCES } from '../summaries/thresholds';
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
  /** Journeys the reading is a live member of (v2 context). */
  journeys?: readonly { id: string; title: string }[];
}

/** A user-confirmed life event, for the before/after context (v2). */
export interface SymbolEvent {
  id: string;
  /** ISO date. */
  occurredOn: string;
  description: string;
}

export type SymbolKind = 'card' | 'suit' | 'theme';

export interface SymbolOccurrence {
  objectId: string;
  at: string;
  position: string | null;
}

export interface SymbolEventContext {
  eventId: string;
  description: string;
  occurredOn: string;
  /** The event relative to the nearest occurrence. */
  relation: 'before' | 'after' | 'same day';
  days: number;
  /** The reading it sits nearest to. */
  objectId: string;
  /** The user confirmed a connection between that reading and this event. */
  confirmed: boolean;
}

export interface RecurringSymbol {
  kind: SymbolKind;
  key: string;
  label: string;
  /** Deck the symbol belongs to; null for themes (they may generalise across decks). */
  deck: { system: 'rws' | 'thoth'; name: string } | null;
  /** Objects it appeared in, newest first. */
  sourceObjectIds: string[];
  /** Every appearance in date order (v2: the sparse timeline). */
  occurrences: SymbolOccurrence[];
  /** Called a pattern only at ≥ PATTERN_MIN_OCCURRENCES distinct readings. */
  isPattern: boolean;
  /** Journeys its readings sit in, most frequent first. */
  journeys: { id: string; title: string; count: number }[];
  /** Confirmed life events within the window of an occurrence, nearest first. */
  around: SymbolEventContext[];
  /** "Appeared in 3 readings between March and July, twice in the outcome position." */
  context: string;
}

const MONTH = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' });
const YEAR = (iso: string) => new Date(iso).getUTCFullYear();
const DAY_MS = 86_400_000;

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

function times(n: number): string {
  return n === 2 ? 'twice' : `${n} times`;
}

export interface SymbolOptions {
  min?: number;
  /** Confirmed life events for the before/after context. */
  events?: readonly SymbolEvent[];
  /** Reading ↔ event pairs the user confirmed a connection for. */
  confirmedLinks?: readonly { readingId: string; eventId: string }[];
  windowDays?: number;
}

export function recurringSymbols(
  objects: readonly SymbolObject[],
  opts: SymbolOptions = {},
): RecurringSymbol[] {
  const min = opts.min ?? RECURRENCE_MIN;
  const total = objects.length;
  const windowMs = (opts.windowDays ?? PATTERN_EVENT_WINDOW_DAYS) * DAY_MS;
  const confirmed = new Set((opts.confirmedLinks ?? []).map((l) => `${l.readingId}:${l.eventId}`));
  const byId = new Map(objects.map((o) => [o.id, o]));

  type Acc = {
    kind: SymbolKind;
    label: string;
    deck: RecurringSymbol['deck'];
    occurrences: Map<string, SymbolOccurrence>;
    positions: Map<string, number>;
  };
  const acc = new Map<string, Acc>();
  const touch = (
    key: string,
    init: () => Omit<Acc, 'occurrences' | 'positions'>,
    o: SymbolObject,
    pos?: string | null,
  ) => {
    const cur = acc.get(key) ?? { ...init(), occurrences: new Map(), positions: new Map() };
    if (!cur.occurrences.has(o.id))
      cur.occurrences.set(o.id, { objectId: o.id, at: o.occurredAt, position: pos ?? null });
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
    if (a.occurrences.size < min) continue;
    const occurrences = [...a.occurrences.values()].sort((x, y) => (x.at < y.at ? -1 : 1));
    const ids = [...occurrences].reverse().map((o) => o.objectId);
    const isos = occurrences.map((o) => o.at);
    const of =
      a.kind === 'theme'
        ? `${total} ${total === 1 ? 'entry' : 'entries'}`
        : plural(total, 'reading');
    let context =
      a.kind === 'suit'
        ? `${a.label} cards turned up in ${a.occurrences.size} of ${of} ${spanText(isos)}`
        : a.kind === 'theme'
          ? `Came up in ${a.occurrences.size} of ${of} ${spanText(isos)}`
          : `Appeared in ${a.occurrences.size} of ${of} ${spanText(isos)}`;
    const repeated = [...a.positions].filter(([, n]) => n >= 2).sort(([, x], [, y]) => y - x)[0];
    if (a.kind === 'card' && repeated)
      context += `, ${times(repeated[1])} in the ${repeated[0].toLowerCase()} position`;
    context += '.';

    // v2 context: journeys, confirmed events around the occurrences, confirmed connections.
    const journeyCounts = new Map<string, { id: string; title: string; count: number }>();
    for (const oc of occurrences)
      for (const j of byId.get(oc.objectId)?.journeys ?? []) {
        const cur = journeyCounts.get(j.id) ?? { id: j.id, title: j.title, count: 0 };
        cur.count += 1;
        journeyCounts.set(j.id, cur);
      }
    const journeys = [...journeyCounts.values()].sort(
      (x, y) => y.count - x.count || x.title.localeCompare(y.title),
    );
    const around: SymbolEventContext[] = [];
    for (const e of opts.events ?? []) {
      const et = Date.parse(`${e.occurredOn}T12:00:00Z`);
      let best: SymbolEventContext | null = null;
      for (const oc of occurrences) {
        const delta = et - Date.parse(oc.at);
        if (Math.abs(delta) > windowMs) continue;
        const days = Math.round(Math.abs(delta) / DAY_MS);
        const candidate: SymbolEventContext = {
          eventId: e.id,
          description: e.description,
          occurredOn: e.occurredOn,
          relation: days === 0 ? 'same day' : delta < 0 ? 'before' : 'after',
          days,
          objectId: oc.objectId,
          confirmed: confirmed.has(`${oc.objectId}:${e.id}`),
        };
        if (
          !best ||
          candidate.confirmed > best.confirmed ||
          (candidate.confirmed === best.confirmed && days < best.days)
        )
          best = candidate;
      }
      if (best) around.push(best);
    }
    around.sort((x, y) => Number(y.confirmed) - Number(x.confirmed) || x.days - y.days);
    if (journeys.length)
      context += ` In ${journeys
        .map((j) => `“${j.title}”`)
        .slice(0, 2)
        .join(' and ')}.`;
    const nearest = around[0];
    if (nearest) {
      const when =
        nearest.relation === 'same day'
          ? 'the same day as'
          : `${plural(nearest.days, 'day')} ${nearest.relation}`;
      context += ` Once ${when} “${nearest.description}”${nearest.confirmed ? ', a connection you confirmed' : ''}.`;
    }

    out.push({
      kind: a.kind,
      key,
      label: a.label,
      deck: a.deck,
      sourceObjectIds: ids,
      occurrences,
      isPattern: a.occurrences.size >= PATTERN_MIN_OCCURRENCES,
      journeys,
      around,
      context,
    });
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

/** Only the symbols that may be called patterns (§3.3): three or more distinct readings. */
export function patterns(symbols: readonly RecurringSymbol[]): RecurringSymbol[] {
  return symbols.filter((s) => s.isPattern);
}

/**
 * Text equivalent of the sparse timeline (a11y): "The Tower: 12 March, 2 May, 18 July."
 */
export function occurrencesSentence(symbol: RecurringSymbol): string {
  const dates = symbol.occurrences.map((o) =>
    new Date(o.at).toLocaleDateString('en', { day: 'numeric', month: 'long', timeZone: 'UTC' }),
  );
  return `${symbol.label}: ${dates.join(', ')}.`;
}
