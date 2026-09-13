/**
 * Journal timeline and search (FR-07, FR-21) through the RLS-respecting user client. One RPC
 * (`search_readings`, SECURITY INVOKER) does text search, card matches, filters, sort and the
 * keyset cursor; PostgREST embeds deck, spread, cards and the one-line interpretation preview
 * on the result — a single round trip, stored rows only, **never a model** (§13).
 */
import type { UserClient } from '@/db/client';
import type { CardView } from '@/domain/decks/types';
import { searchCards } from '@/domain/decks/search';
import {
  decodeCursor,
  encodeCursor,
  JOURNAL_PAGE_SIZE,
  dayRangeToInstants,
  sortKeyOf,
  type JournalFilters,
} from '@/domain/journal/filters';
import type { FollowUpStatus, Orientation, ReadingSource } from '@/domain/readings/types';
import { CARD_VIEW_COLUMNS, listCards, listDecks, toCardView, type RawCard } from './decks';

export class JournalQueryError extends Error {
  override name = 'JournalQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface JournalItemCard {
  position_index: number;
  orientation: Orientation;
  card: CardView;
}

/** One timeline row: everything the list renders, from stored columns only. */
export interface JournalItem {
  id: string;
  occurred_at: string;
  updated_at: string;
  question: string | null;
  is_open_reflection: boolean;
  life_area: string | null;
  source: ReadingSource;
  follow_up_status: FollowUpStatus;
  revisit_at: string | null;
  user_notes: string | null;
  /** The current interpretation's first layer, if one exists — selected, never generated. */
  synthesis: string | null;
  deck: { id: string; slug: string; name: string; system: CardView['deck_system'] };
  spread: { id: string; name: string; card_count: number };
  cards: JournalItemCard[];
}

export interface JournalPage {
  items: JournalItem[];
  nextCursor: string | null;
  /** Card ids the free-text query matched through names or aliases (to highlight in the UI). */
  matchedCardIds: string[];
}

const ITEM_SELECT =
  'id, occurred_at, updated_at, question, is_open_reflection, life_area, source, follow_up_status, ' +
  'revisit_at, user_notes, decks(id, slug, name, system), spreads(id, name, card_count), ' +
  `reading_cards(position_index, orientation, cards(${CARD_VIEW_COLUMNS})), ` +
  'interpretations(synthesis, status, superseded_by)';

interface RawItem {
  id: string;
  occurred_at: string;
  updated_at: string;
  question: string | null;
  is_open_reflection: boolean;
  life_area: string | null;
  source: ReadingSource;
  follow_up_status: FollowUpStatus;
  revisit_at: string | null;
  user_notes: string | null;
  decks: JournalItem['deck'];
  spreads: JournalItem['spread'];
  reading_cards: { position_index: number; orientation: Orientation; cards: RawCard }[];
  interpretations: { synthesis: string | null; status: string; superseded_by: string | null }[];
}

function toItem(raw: RawItem): JournalItem {
  const { decks: deck, spreads: spread, reading_cards, interpretations, ...row } = raw;
  return {
    ...row,
    // The current interpretation: complete and not superseded (a handful of rows at most;
    // PostgREST cannot filter an embed on an RPC result, so the pick happens here).
    synthesis:
      interpretations.find((i) => i.status === 'complete' && i.superseded_by === null)?.synthesis ??
      null,
    deck,
    spread,
    cards: reading_cards
      .slice()
      .sort((a, b) => a.position_index - b.position_index)
      .map((rc) => ({
        position_index: rc.position_index,
        orientation: rc.orientation,
        card: toCardView(rc.cards, { system: deck.system, name: deck.name }),
      })),
  };
}

export interface SearchOptions {
  cursor?: string | null;
  limit?: number;
  /** The viewer's zone for the date-range filter; UTC when unknown. */
  timeZone?: string;
}

/**
 * Card ids whose deck-native name, title or alias matches the query (both decks), so
 * "strength" finds Thoth *Lust* and the result shows its actual name (FR-03C). Exact and
 * prefix matches only — fuzzy hits would turn "money" into a card search.
 */
export async function resolveQueryCardIds(client: UserClient, q: string): Promise<string[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return searchCards(await allCards(client), term, { limit: 40 })
    .filter((h) => h.matched !== 'fuzzy' && h.score >= 50)
    .map((h) => h.card.id);
}

/** Reference cards are global and immutable between deploys: memoised per process briefly. */
const CARDS_MEMO_MS = 5 * 60_000;
let cardsMemo: { at: number; cards: Awaited<ReturnType<typeof listCards>> } | null = null;

async function allCards(client: UserClient) {
  if (cardsMemo && Date.now() - cardsMemo.at < CARDS_MEMO_MS) return cardsMemo.cards;
  const decks = await listDecks(client);
  const cards = (await Promise.all(decks.map((d) => listCards(client, d)))).flat();
  cardsMemo = { at: Date.now(), cards };
  return cards;
}

export async function searchJournal(
  client: UserClient,
  filters: JournalFilters,
  opts: SearchOptions = {},
): Promise<JournalPage> {
  const limit = Math.min(Math.max(opts.limit ?? JOURNAL_PAGE_SIZE, 1), 100);
  const cursor = decodeCursor(opts.cursor);
  const range = dayRangeToInstants(filters.from, filters.to, opts.timeZone);

  let deckId: string | null = null;
  if (filters.deck) {
    const deck = (await listDecks(client)).find((d) => d.slug === filters.deck);
    if (!deck) return { items: [], nextCursor: null, matchedCardIds: [] };
    deckId = deck.id;
  }
  const matchedCardIds = filters.q ? await resolveQueryCardIds(client, filters.q) : [];

  const p = {
    q: filters.q || null,
    q_card_ids: matchedCardIds.length ? matchedCardIds : null,
    from: range.from,
    to: range.to,
    deck_id: deckId,
    spread_id: filters.spread,
    entity_id: filters.entity,
    source: filters.source,
    follow_up: filters.followUp,
    has_notes: filters.hasNotes,
    has_interpretation: filters.hasInterpretation,
    sort: filters.sort,
    limit: limit + 1,
    after_key: cursor?.key ?? null,
    after_id: cursor?.id ?? null,
  };

  const { data, error } = await client.rpc('search_readings', { p }).select(ITEM_SELECT);
  if (error) throw new JournalQueryError('journal search failed', error.code);

  const rows = ((data ?? []) as unknown as RawItem[]).map(toItem);
  // The function orders its rows; re-sort defensively so the cursor is always consistent.
  const key = sortKeyOf(filters.sort);
  const dir = filters.sort === 'oldest' ? 1 : -1;
  rows.sort((a, b) => {
    const ka = new Date(a[key]).getTime();
    const kb = new Date(b[key]).getTime();
    if (ka !== kb) return (ka - kb) * dir;
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * dir;
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ key: last[key], id: last.id }) : null,
    matchedCardIds,
  };
}

/** Live reading count — one `head` request, for the empty vs. no-results distinction. */
export async function countReadings(client: UserClient): Promise<number> {
  const { count, error } = await client
    .from('readings')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (error) throw new JournalQueryError('journal count failed', error.code);
  return count ?? 0;
}
