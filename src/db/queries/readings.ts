/**
 * Reading reads/writes through the RLS-respecting user client. Rows stay snake_case like the
 * wire format. Nothing in this module talks to a model; opening a reading is one PostgREST
 * read that embeds deck, spread and the deck-native card rows (invariant: opening a saved
 * reading makes zero AI calls). Card names and meanings come from `cards` only — never from
 * the archetype tables (§6.7).
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import type { CardView, SpreadPosition } from '@/domain/decks/types';
import { restoreDraft, type ReadingDraft } from '@/domain/readings/draft';
import type { DrawRecord } from '@/domain/readings/draw';
import {
  createReadingInputSchema,
  FOLLOW_UP_STATUSES,
  NOTES_MAX,
  placedCardSchema,
  updateReadingInputSchema,
  type CreateReadingInput,
  type FollowUpStatus,
  type Orientation,
  type PlacedCard,
  type ReadingSource,
  type UpdateReadingInput,
} from '@/domain/readings/types';
import { CUSTOM_SPREAD_MAX_POSITIONS } from '@/domain/readings/thresholds';
import {
  CARD_VIEW_COLUMNS,
  DECK_COLUMNS,
  SPREAD_COLUMNS,
  toCardView,
  type DeckRow,
  type RawCard,
  type SpreadView,
} from './decks';

export class ReadingQueryError extends Error {
  override name = 'ReadingQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ReadingRow {
  id: string;
  user_id: string;
  created_at: string;
  occurred_at: string;
  question: string | null;
  is_open_reflection: boolean;
  life_area: string | null;
  spread_id: string;
  deck_id: string;
  source: ReadingSource;
  uses_reversals: boolean;
  user_notes: string | null;
  follow_up_status: FollowUpStatus;
  revisit_at: string | null;
  rng: DrawRecord | null;
  metadata_version: number;
  updated_at: string;
}

/** A card in a reading, with the deck-native reference row it resolves to. */
export interface ReadingCardView {
  id: string;
  position_index: number;
  position_key: string;
  orientation: Orientation;
  user_meaning: string | null;
  card: CardView & {
    keywords_upright: string[];
    keywords_reversed: string[];
    meaning_upright: string;
    meaning_reversed: string | null;
  };
  /** The spread position (name + prompt); null if the spread changed shape since. */
  position: SpreadPosition | null;
}

export interface ReadingView extends ReadingRow {
  deck: DeckRow;
  spread: SpreadView;
  cards: ReadingCardView[];
}

/** Compact row for lists (Home "Still open", recent-cards lookups). */
export interface ReadingSummary {
  id: string;
  occurred_at: string;
  question: string | null;
  is_open_reflection: boolean;
  life_area: string | null;
  follow_up_status: FollowUpStatus;
  revisit_at: string | null;
  source: ReadingSource;
  deck: Pick<DeckRow, 'id' | 'name' | 'system'>;
  spread: Pick<SpreadView, 'id' | 'name' | 'card_count'>;
}

const READING_COLUMNS =
  'id, user_id, created_at, occurred_at, question, is_open_reflection, life_area, spread_id, ' +
  'deck_id, source, uses_reversals, user_notes, follow_up_status, revisit_at, rng, ' +
  'metadata_version, updated_at';

const CARD_REF_COLUMNS =
  CARD_VIEW_COLUMNS + ', keywords_upright, keywords_reversed, meaning_upright, meaning_reversed';

const READING_VIEW_SELECT =
  `${READING_COLUMNS}, decks(${DECK_COLUMNS}), spreads(${SPREAD_COLUMNS}), ` +
  `reading_cards(id, position_index, position_key, orientation, user_meaning, cards(${CARD_REF_COLUMNS}))`;

const SUMMARY_SELECT =
  'id, occurred_at, question, is_open_reflection, life_area, follow_up_status, revisit_at, source, ' +
  'decks(id, name, system), spreads(id, name, card_count)';

interface RawReadingCard {
  id: string;
  position_index: number;
  position_key: string;
  orientation: Orientation;
  user_meaning: string | null;
  cards: RawCard;
}

interface RawReadingView extends ReadingRow {
  decks: DeckRow;
  spreads: SpreadView;
  reading_cards: RawReadingCard[];
}

function toView(raw: RawReadingView): ReadingView {
  const { decks: deck, spreads: spread, reading_cards, ...row } = raw;
  const cards = reading_cards
    .slice()
    .sort((a, b) => a.position_index - b.position_index)
    .map((rc) => ({
      id: rc.id,
      position_index: rc.position_index,
      position_key: rc.position_key,
      orientation: rc.orientation,
      user_meaning: rc.user_meaning,
      card: {
        ...toCardView(rc.cards, deck),
        keywords_upright: rc.cards.keywords_upright ?? [],
        keywords_reversed: rc.cards.keywords_reversed ?? [],
        meaning_upright: rc.cards.meaning_upright ?? '',
        meaning_reversed: rc.cards.meaning_reversed ?? null,
      },
      position: spread.positions[rc.position_index] ?? null,
    }));
  return { ...row, deck, spread, cards };
}

/**
 * Transactional save through `create_reading()` (migration 0004): reading + cards, or nothing.
 * The input is validated here again — the draft on the client is never trusted.
 */
export async function createReading(
  client: UserClient,
  input: CreateReadingInput,
): Promise<string> {
  const clean = createReadingInputSchema.parse(input);
  const { data, error } = await client.rpc('create_reading', { p: clean });
  if (error) throw new ReadingQueryError('reading create failed', error.code);
  return z.string().uuid().parse(data);
}

export async function getReading(client: UserClient, id: string): Promise<ReadingView | null> {
  const { data, error } = await client
    .from('readings')
    .select(READING_VIEW_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ReadingQueryError('reading read failed', error.code);
  return data ? toView(data as unknown as RawReadingView) : null;
}

export async function listReadings(
  client: UserClient,
  opts: { limit?: number; followUp?: FollowUpStatus } = {},
): Promise<ReadingSummary[]> {
  let q = client
    .from('readings')
    .select(SUMMARY_SELECT)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.followUp) q = q.eq('follow_up_status', opts.followUp);
  const { data, error } = await q;
  if (error) throw new ReadingQueryError('readings read failed', error.code);
  return (
    (data ?? []) as unknown as (Omit<ReadingSummary, 'deck' | 'spread'> & {
      decks: ReadingSummary['deck'];
      spreads: ReadingSummary['spread'];
    })[]
  ).map(({ decks, spreads, ...r }) => ({ ...r, deck: decks, spread: spreads }));
}

/** Summaries for a known set of ids (the repeat-question nudge), newest first. */
export async function listReadingSummariesByIds(
  client: UserClient,
  ids: readonly string[],
): Promise<ReadingSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('readings')
    .select(SUMMARY_SELECT)
    .in('id', [...ids])
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false });
  if (error) throw new ReadingQueryError('readings read failed', error.code);
  return (
    (data ?? []) as unknown as (Omit<ReadingSummary, 'deck' | 'spread'> & {
      decks: ReadingSummary['deck'];
      spreads: ReadingSummary['spread'];
    })[]
  ).map(({ decks, spreads, ...r }) => ({ ...r, deck: decks, spread: spreads }));
}

/** Most recently used card ids in a deck (for the picker's recent row), newest first, deduped. */
export async function listRecentCardIds(
  client: UserClient,
  deckId: string,
  limit = 8,
): Promise<string[]> {
  const { data, error } = await client
    .from('reading_cards')
    .select('card_id, created_at, cards!inner(deck_id)')
    .eq('cards.deck_id', deckId)
    .order('created_at', { ascending: false })
    .limit(limit * 5);
  if (error) throw new ReadingQueryError('recent cards read failed', error.code);
  const seen = new Set<string>();
  for (const r of (data ?? []) as { card_id: string }[]) {
    seen.add(r.card_id);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

export async function updateReading(
  client: UserClient,
  id: string,
  patch: UpdateReadingInput,
): Promise<void> {
  const clean = updateReadingInputSchema.parse(patch);
  const { data, error } = await client
    .from('readings')
    .update({ ...clean, question: clean.is_open_reflection ? null : clean.question })
    .eq('id', id)
    .select('id');
  if (error) throw new ReadingQueryError('reading update failed', error.code);
  if (!data?.length) throw new ReadingQueryError('reading not found', 'P0002');
}

/** The user's own words. Only ever set from user input; nothing else writes this column. */
export async function updateReadingNotes(
  client: UserClient,
  id: string,
  notes: string,
): Promise<void> {
  const user_notes = z.string().max(NOTES_MAX).parse(notes).trim() || null;
  const { data, error } = await client
    .from('readings')
    .update({ user_notes })
    .eq('id', id)
    .select('id');
  if (error) throw new ReadingQueryError('notes update failed', error.code);
  if (!data?.length) throw new ReadingQueryError('reading not found', 'P0002');
}

export async function setFollowUpStatus(
  client: UserClient,
  id: string,
  status: FollowUpStatus,
): Promise<void> {
  const follow_up_status = z.enum(FOLLOW_UP_STATUSES).parse(status);
  const { data, error } = await client
    .from('readings')
    .update({ follow_up_status })
    .eq('id', id)
    .select('id');
  if (error) throw new ReadingQueryError('follow-up update failed', error.code);
  if (!data?.length) throw new ReadingQueryError('reading not found', 'P0002');
}

export async function setRevisitAt(
  client: UserClient,
  id: string,
  revisitAt: string | null,
): Promise<void> {
  const revisit_at = z.string().datetime({ offset: true }).nullable().parse(revisitAt);
  const { data, error } = await client
    .from('readings')
    .update({ revisit_at })
    .eq('id', id)
    .select('id');
  if (error) throw new ReadingQueryError('revisit update failed', error.code);
  if (!data?.length) throw new ReadingQueryError('reading not found', 'P0002');
}

/** Atomic replacement of every position via `replace_reading_cards()`. */
export async function replaceReadingCards(
  client: UserClient,
  id: string,
  cards: PlacedCard[],
): Promise<void> {
  const clean = z.array(placedCardSchema).min(1).max(CUSTOM_SPREAD_MAX_POSITIONS).parse(cards);
  const { error } = await client.rpc('replace_reading_cards', {
    p_reading_id: id,
    p_cards: clean,
  });
  if (error) throw new ReadingQueryError('cards update failed', error.code);
}

/** Hard delete: nothing derived exists yet; `reading_cards` cascade. Phase 05 adds the purge job. */
export async function deleteReading(client: UserClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('readings').delete().eq('id', id).select('id');
  if (error) throw new ReadingQueryError('reading delete failed', error.code);
  return (data?.length ?? 0) > 0;
}

// ── Server-side draft (one per user) ──────────────────────────────────────────────────────

export async function getServerDraft(
  client: UserClient,
  userId: string,
): Promise<ReadingDraft | null> {
  const { data, error } = await client
    .from('reading_drafts')
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ReadingQueryError('draft read failed', error.code);
  return data ? restoreDraft((data as { payload: unknown }).payload) : null;
}

export async function upsertServerDraft(
  client: UserClient,
  userId: string,
  draft: ReadingDraft,
): Promise<void> {
  const { error } = await client
    .from('reading_drafts')
    .upsert({ user_id: userId, payload: draft }, { onConflict: 'user_id' });
  if (error) throw new ReadingQueryError('draft write failed', error.code);
}

export async function deleteServerDraft(client: UserClient, userId: string): Promise<void> {
  const { error } = await client.from('reading_drafts').delete().eq('user_id', userId);
  if (error) throw new ReadingQueryError('draft delete failed', error.code);
}
