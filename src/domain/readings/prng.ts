/**
 * Seeded PRNG for the draw engine (docs/ALGORITHMS.md#6-digital-draw-rng-fr-04-62).
 *
 * xoshiro128** — 128-bit state, so a 16-byte seed can reach every 5-card outcome from a 78-card
 * deck (≈ 9·10¹⁰ outcomes ≪ 2¹²⁸). The seed is what gets persisted in `readings.rng`: given the
 * seed and the deck order, anyone can replay the draw and confirm no model chose the cards.
 * Production seeds come from `crypto.randomBytes`; tests pass a fixed hex string.
 */

export interface Rng {
  /** Uniform integer in [0, maxExclusive). Rejection-sampled: no modulo bias. */
  int(maxExclusive: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

export const SEED_BYTES = 16;

const HEX_RE = /^[0-9a-f]+$/i;

export function seededRng(seedHex: string): Rng {
  if (seedHex.length !== SEED_BYTES * 2 || !HEX_RE.test(seedHex)) {
    throw new Error(`seed must be ${SEED_BYTES * 2} hex characters`);
  }
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) s[i] = parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  // An all-zero state is the one fixed point of xoshiro; splitmix it away.
  if (s.every((w) => w === 0)) s[0] = 0x9e3779b9;

  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  function next(): number {
    const result = (Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0) as number;
    const t = (s[1]! << 9) >>> 0;
    s[2] = (s[2]! ^ s[0]!) >>> 0;
    s[3] = (s[3]! ^ s[1]!) >>> 0;
    s[1] = (s[1]! ^ s[2]!) >>> 0;
    s[0] = (s[0]! ^ s[3]!) >>> 0;
    s[2] = (s[2]! ^ t) >>> 0;
    s[3] = rotl(s[3]!, 11);
    return result;
  }

  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
        throw new RangeError('int() needs an integer bound in (0, 2^32]');
      }
      // Largest multiple of maxExclusive that fits in 32 bits; reject draws above it.
      const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive);
      let x = next();
      while (x >= limit) x = next();
      return x % maxExclusive;
    },
    float(): number {
      return next() / 0x1_0000_0000;
    },
  };
}
