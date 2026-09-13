/**
 * pg_trgm-compatible trigram similarity, in TypeScript. Postgres computes the real thing for
 * candidate generation (`similarity()` over `entity_aliases.alias_normalized`); this mirror
 * lets the pure resolver be exercised in fixture tests and the mock extractor without a
 * database. Same construction as pg_trgm: each word padded with two leading and one trailing
 * space, trigrams over the padded words, Jaccard over the sets.
 */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
