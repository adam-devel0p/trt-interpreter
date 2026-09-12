/**
 * Deck reference reads through an RLS-respecting client (anon for public pages, the session
 * client in-app). Rows stay snake_case like the wire format. Everything a render path needs
 * comes from `decks`, `cards`, `card_aliases` and `spreads` — never from the archetype tables,
 * which are search/analytics metadata (§6.7; invariant thoth-never-substitutes-rws).
 */
import type { UserClient } from '@/db/client';
import type { SearchableAlias } from '@/domain/decks/search';
import type {
  Arcana,
  ArtStrategy,
  CardView,
  Correspondences,
  DeckSystem,
  Element,
  SpreadLayout,
  SpreadPosition,
  Suit,
} from '@/domain/decks/types';

export interface DeckRow {
  id: string;
  slug: string;
  name: string;
  system: DeckSystem;
  tradition_notes: string;
  supports_reversals: boolean;
  art_strategy: ArtStrategy;
  license_note: string;
  sort_order: number;
}

export interface CardDetail extends CardView {
  keywords_upright: string[];
  keywords_reversed: string[];
  meaning_upright: string;
  meaning_reversed: string | null;
  symbolism: string;
  deck_slug: string;
  deck_supports_reversals: boolean;
  aliases: SearchableAlias[];
}

export type PickerCard = CardView & { aliases: SearchableAlias[] };

export interface SpreadView {
  id: string;
  user_id: string | null;
  slug: string;
  name: string;
  description: string;
  positions: SpreadPosition[];
  layout: SpreadLayout;
  is_builtin: boolean;
  deck_scope: DeckSystem | null;
  card_count: number;
  sort_order: number;
}

export class DeckQueryError extends Error {
  override name = 'DeckQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const DECK_COLUMNS =
  'id, slug, name, system, tradition_notes, supports_reversals, art_strategy, license_note, sort_order';

const CARD_VIEW_COLUMNS =
  'id, deck_id, slug, name, title, arcana, suit, suit_label, rank_label, number, numeral, element, ' +
  'astrology, correspondences, art_asset_path, sort_order';

const CARD_DETAIL_COLUMNS =
  CARD_VIEW_COLUMNS +
  ', keywords_upright, keywords_reversed, meaning_upright, meaning_reversed, symbolism, ' +
  'card_aliases(alias, kind)';

const SPREAD_COLUMNS =
  'id, user_id, slug, name, description, positions, layout, is_builtin, deck_scope, card_count, sort_order';

interface RawCard {
  id: string;
  deck_id: string;
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
  keywords_upright?: string[];
  keywords_reversed?: string[];
  meaning_upright?: string;
  meaning_reversed?: string | null;
  symbolism?: string;
  card_aliases?: SearchableAlias[];
}

function toView(raw: RawCard, deck: Pick<DeckRow, 'system' | 'name'>): CardView {
  return {
    id: raw.id,
    deck_id: raw.deck_id,
    deck_system: deck.system,
    deck_name: deck.name,
    slug: raw.slug,
    name: raw.name,
    title: raw.title,
    arcana: raw.arcana,
    suit: raw.suit,
    suit_label: raw.suit_label,
    rank_label: raw.rank_label,
    number: raw.number,
    numeral: raw.numeral,
    element: raw.element,
    astrology: raw.astrology,
    correspondences: raw.correspondences ?? {},
    art_asset_path: raw.art_asset_path,
    sort_order: raw.sort_order,
  };
}

export async function listDecks(client: UserClient): Promise<DeckRow[]> {
  const { data, error } = await client.from('decks').select(DECK_COLUMNS).order('sort_order');
  if (error) throw new DeckQueryError('decks read failed', error.code);
  return (data ?? []) as unknown as DeckRow[];
}

export async function getDeckBySlug(client: UserClient, slug: string): Promise<DeckRow | null> {
  const { data, error } = await client
    .from('decks')
    .select(DECK_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new DeckQueryError('deck read failed', error.code);
  return (data as unknown as DeckRow | null) ?? null;
}

export async function getDeckById(client: UserClient, id: string): Promise<DeckRow | null> {
  const { data, error } = await client
    .from('decks')
    .select(DECK_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DeckQueryError('deck read failed', error.code);
  return (data as unknown as DeckRow | null) ?? null;
}

/** All 78 cards of a deck in deck order, with aliases — what the picker and the grid render. */
export async function listCards(client: UserClient, deck: DeckRow): Promise<PickerCard[]> {
  const { data, error } = await client
    .from('cards')
    .select(`${CARD_VIEW_COLUMNS}, card_aliases(alias, kind)`)
    .eq('deck_id', deck.id)
    .order('sort_order');
  if (error) throw new DeckQueryError('cards read failed', error.code);
  return ((data ?? []) as unknown as RawCard[]).map((r) => ({
    ...toView(r, deck),
    aliases: r.card_aliases ?? [],
  }));
}

export async function getCardBySlug(
  client: UserClient,
  deck: DeckRow,
  slug: string,
): Promise<CardDetail | null> {
  const { data, error } = await client
    .from('cards')
    .select(CARD_DETAIL_COLUMNS)
    .eq('deck_id', deck.id)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new DeckQueryError('card read failed', error.code);
  if (!data) return null;
  const r = data as unknown as RawCard;
  return {
    ...toView(r, deck),
    keywords_upright: r.keywords_upright ?? [],
    keywords_reversed: r.keywords_reversed ?? [],
    meaning_upright: r.meaning_upright ?? '',
    meaning_reversed: r.meaning_reversed ?? null,
    symbolism: r.symbolism ?? '',
    deck_slug: deck.slug,
    deck_supports_reversals: deck.supports_reversals,
    aliases: r.card_aliases ?? [],
  };
}

/** Previous/next card in deck order, for detail-page navigation. */
export async function neighbourCards(
  client: UserClient,
  deck: DeckRow,
  sortOrder: number,
): Promise<{
  prev: Pick<CardView, 'slug' | 'name'> | null;
  next: Pick<CardView, 'slug' | 'name'> | null;
}> {
  const { data, error } = await client
    .from('cards')
    .select('slug, name, sort_order')
    .eq('deck_id', deck.id)
    .in('sort_order', [sortOrder - 1, sortOrder + 1]);
  if (error) throw new DeckQueryError('cards read failed', error.code);
  const rows = (data ?? []) as { slug: string; name: string; sort_order: number }[];
  const pick = (n: number) => rows.find((r) => r.sort_order === n) ?? null;
  return { prev: pick(sortOrder - 1), next: pick(sortOrder + 1) };
}

/** Built-in spreads plus the caller's own (RLS decides which of those are visible). */
export async function listSpreads(client: UserClient): Promise<SpreadView[]> {
  const { data, error } = await client.from('spreads').select(SPREAD_COLUMNS).order('sort_order');
  if (error) throw new DeckQueryError('spreads read failed', error.code);
  return (data ?? []) as unknown as SpreadView[];
}

export async function getBuiltinSpreadBySlug(
  client: UserClient,
  slug: string,
): Promise<SpreadView | null> {
  const { data, error } = await client
    .from('spreads')
    .select(SPREAD_COLUMNS)
    .eq('slug', slug)
    .is('user_id', null)
    .maybeSingle();
  if (error) throw new DeckQueryError('spread read failed', error.code);
  return (data as unknown as SpreadView | null) ?? null;
}
