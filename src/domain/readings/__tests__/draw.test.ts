import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { drawCards, partialShuffle, replayDraw } from '../draw';
import { seededRng } from '../prng';

const DECK = Array.from({ length: 78 }, (_, i) => `card-${String(i).padStart(2, '0')}`);
const DECK_ID = '00000000-0000-4000-8000-000000000001';
const seed = (n: number) => n.toString(16).padStart(32, '0');
const freshSeed = () => randomBytes(16).toString('hex');

describe('seededRng (xoshiro128**)', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = seededRng(seed(1));
    const b = seededRng(seed(1));
    const c = seededRng(seed(2));
    const seqA = Array.from({ length: 10 }, () => a.int(1000));
    expect(Array.from({ length: 10 }, () => b.int(1000))).toEqual(seqA);
    expect(Array.from({ length: 10 }, () => c.int(1000))).not.toEqual(seqA);
  });

  it('rejects malformed seeds and bad bounds', () => {
    expect(() => seededRng('abc')).toThrow(/32 hex/);
    expect(() => seededRng('zz'.repeat(16))).toThrow(/32 hex/);
    expect(() => seededRng(seed(1)).int(0)).toThrow(RangeError);
    expect(() => seededRng(seed(1)).int(1.5)).toThrow(RangeError);
  });

  it('int() stays in range and float() in [0, 1)', () => {
    const r = seededRng(freshSeed());
    for (let i = 0; i < 10_000; i++) {
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('drawCards', () => {
  it('is deterministic with a seed and reproducible through replayDraw', () => {
    const s = seed(0xdeadbeef);
    const one = drawCards({
      cardIds: DECK,
      deckId: DECK_ID,
      count: 5,
      usesReversals: true,
      seed: s,
    });
    const two = drawCards({
      cardIds: DECK,
      deckId: DECK_ID,
      count: 5,
      usesReversals: true,
      seed: s,
    });
    expect(one.cards).toEqual(two.cards);
    expect(replayDraw(one.rng, DECK, 5)).toEqual(one.cards);
    expect(one.rng).toMatchObject({
      algorithm: 'fisher-yates/xoshiro128**',
      seed: s,
      deck_id: DECK_ID,
      deck_size: 78,
      reversal_probability: 0.5,
    });
    expect(one.rng.drawn_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('never draws a reversed card when the reading does not use reversals (Thoth, or reversals off)', () => {
    for (let i = 0; i < 2_000; i++) {
      const { cards, rng } = drawCards({
        cardIds: DECK,
        deckId: DECK_ID,
        count: 3,
        usesReversals: false,
        seed: freshSeed(),
      });
      expect(cards.every((c) => c.orientation === 'upright')).toBe(true);
      expect(rng.reversal_probability).toBe(0);
    }
  });

  it('validates its input', () => {
    const base = { cardIds: DECK, deckId: DECK_ID, usesReversals: true, seed: seed(3) };
    expect(() => drawCards({ ...base, count: 0 })).toThrow(RangeError);
    expect(() => drawCards({ ...base, count: 79 })).toThrow(RangeError);
    expect(() => drawCards({ ...base, count: 1, cardIds: ['a', 'a'] })).toThrow(/unique/);
    expect(() =>
      replayDraw({ ...drawCards({ ...base, count: 1 }).rng, deck_size: 77 }, DECK, 1),
    ).toThrow(/deck size/);
  });

  describe('statistics (100k draws)', () => {
    const N = 100_000;
    // One seeded generator drives all draws so the test is deterministic; the bounds below are
    // ≥ 5σ so they would hold for any seed.
    const master = seededRng(seed(0x5eed));
    const nextSeed = () =>
      Array.from({ length: 4 }, () => master.int(0x1_0000_0000).toString(16).padStart(8, '0')).join(
        '',
      );

    it('every card is equally likely in every position, no spread repeats a card, reversal rate ≈ 0.5', () => {
      const COUNT = 3;
      const perPosition = Array.from({ length: COUNT }, () => new Map<string, number>());
      let reversed = 0;
      for (let i = 0; i < N; i++) {
        const { cards } = drawCards({
          cardIds: DECK,
          deckId: DECK_ID,
          count: COUNT,
          usesReversals: true,
          seed: nextSeed(),
        });
        expect(new Set(cards.map((c) => c.card_id)).size).toBe(COUNT);
        for (const c of cards) {
          const m = perPosition[c.position_index]!;
          m.set(c.card_id, (m.get(c.card_id) ?? 0) + 1);
          if (c.orientation === 'reversed') reversed++;
        }
      }
      const expected = N / 78; // ≈ 1282
      const sigma = Math.sqrt(N * (1 / 78) * (77 / 78)); // ≈ 35.6
      for (const m of perPosition) {
        expect(m.size).toBe(78);
        for (const [id, n] of m) {
          expect(Math.abs(n - expected), `${id}: ${n} vs ${expected}`).toBeLessThan(5 * sigma);
        }
      }
      const rate = reversed / (N * COUNT);
      expect(Math.abs(rate - 0.5)).toBeLessThan(0.005); // 5σ ≈ 0.0046 at 300k Bernoulli trials
    });
  });
});

describe('partialShuffle', () => {
  it('returns the first `count` cards of a full Fisher–Yates shuffle', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const a = partialShuffle(items, 3, seededRng(seed(9)));
    const full = partialShuffle(items, 6, seededRng(seed(9)));
    expect(a).toEqual(full.slice(0, 3));
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']); // input untouched
  });
});
