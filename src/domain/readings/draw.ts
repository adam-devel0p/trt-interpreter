/**
 * Digital draw (FR-04, §6.2): a pure Fisher–Yates partial shuffle over the supplied card IDs,
 * driven by an injectable RNG so it is deterministic in tests and seeded from `crypto` in
 * production. Runs server-side, before any AI exists in the flow. The returned `rng` record is
 * persisted on the reading so the draw is auditable and replayable (docs/ALGORITHMS.md §6).
 */
import { seededRng, type Rng } from './prng';
import type { Orientation } from './types';
import { REVERSAL_PROBABILITY } from './thresholds';

export const DRAW_ALGORITHM = 'fisher-yates/xoshiro128**' as const;

export interface DrawnCard {
  position_index: number;
  card_id: string;
  orientation: Orientation;
}

/** Stored verbatim in `readings.rng`. Content-free: IDs and numbers only. */
export interface DrawRecord {
  algorithm: typeof DRAW_ALGORITHM;
  seed: string;
  drawn_at: string;
  deck_id: string;
  deck_size: number;
  reversal_probability: number;
}

export interface DrawInput {
  /** The deck's card IDs in deck order (`sort_order`). Order is part of the audit record. */
  cardIds: readonly string[];
  deckId: string;
  count: number;
  /** Effective reversals for the reading: `deck.supports_reversals && profile.use_reversals`. */
  usesReversals: boolean;
  seed: string;
  now?: Date;
  reversalProbability?: number;
}

export function drawCards(input: DrawInput): { cards: DrawnCard[]; rng: DrawRecord } {
  const { cardIds, deckId, count, usesReversals } = input;
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be ≥ 1');
  if (count > cardIds.length) throw new RangeError('count exceeds the deck');
  if (new Set(cardIds).size !== cardIds.length) throw new Error('cardIds must be unique');
  const probability = usesReversals ? (input.reversalProbability ?? REVERSAL_PROBABILITY) : 0;
  const rng = seededRng(input.seed);
  const picked = partialShuffle(cardIds, count, rng);
  const cards = picked.map((card_id, position_index) => ({
    position_index,
    card_id,
    orientation: reversedBy(rng, probability),
  }));
  return {
    cards,
    rng: {
      algorithm: DRAW_ALGORITHM,
      seed: input.seed,
      drawn_at: (input.now ?? new Date()).toISOString(),
      deck_id: deckId,
      deck_size: cardIds.length,
      reversal_probability: probability,
    },
  };
}

/** The first `count` steps of a Fisher–Yates shuffle: exactly the cards a full shuffle would deal. */
export function partialShuffle<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const a = items.slice();
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(a.length - i);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a.slice(0, count);
}

function reversedBy(rng: Rng, probability: number): Orientation {
  if (probability <= 0) return 'upright';
  return rng.float() < probability ? 'reversed' : 'upright';
}

/** Replays a persisted draw; equal output proves the record is what produced the cards. */
export function replayDraw(
  record: DrawRecord,
  cardIds: readonly string[],
  count: number,
): DrawnCard[] {
  if (record.deck_size !== cardIds.length) throw new Error('deck size changed since the draw');
  return drawCards({
    cardIds,
    deckId: record.deck_id,
    count,
    usesReversals: record.reversal_probability > 0,
    reversalProbability: record.reversal_probability,
    seed: record.seed,
    now: new Date(record.drawn_at),
  }).cards;
}
