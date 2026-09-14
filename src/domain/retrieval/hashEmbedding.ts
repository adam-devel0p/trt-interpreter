/**
 * Deterministic hashed bag-of-words embedding, unit length, at the real model's
 * dimensionality. It is what the mock provider returns (src/ai/providers/mock.ts) and what
 * fixtures use to give labelled objects a vector without a network: identical texts score
 * 1.0, paraphrases share most words, unrelated texts score low. Not a substitute for a
 * trained embedding — enough for rules, ranking and thresholds to be tested.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export function hashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    const idx = Math.abs(h) % EMBEDDING_DIMENSIONS;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** pgvector's text form: `[0.1,0.2,…]`. */
export function vectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toString() : '0')).join(',')}]`;
}

/** Inverse of `vectorLiteral` (postgres-js returns vectors as text). */
export function parseVectorLiteral(s: string | null | undefined): number[] | null {
  if (!s) return null;
  const inner = s.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner) return null;
  const out = inner.split(',').map(Number);
  return out.some((x) => !Number.isFinite(x)) ? null : out;
}
