/**
 * Step 5 of hybrid retrieval (docs/ALGORITHMS.md §4): the evidence package is bounded to at
 * most 24 whole objects and 6 000 tokens of evidence. Over the cap, the lowest-ranked whole
 * objects are dropped — never truncated mid-way — and what was dropped is recorded so the
 * answer's provenance (`ai_calls.object_refs`, the `asks` row) says what the model did not see.
 * The pipeline hands objects in rank order; augmentation (linked events, outcomes) sits on
 * its anchor's rank, so an anchor never survives without the context that made it evidence.
 */

export const PACKAGE_MAX_OBJECTS = 24;
export const PACKAGE_MAX_TOKENS = 6000;

/** Four characters per token is the conservative English estimate; the real count is lower. */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface Boundable {
  id: string;
  tokens: number;
}

export interface BoundResult<T extends Boundable> {
  kept: T[];
  dropped: T[];
  tokens: number;
}

export function boundPackage<T extends Boundable>(
  ranked: readonly T[],
  limits: { maxObjects?: number; maxTokens?: number } = {},
): BoundResult<T> {
  const maxObjects = limits.maxObjects ?? PACKAGE_MAX_OBJECTS;
  const maxTokens = limits.maxTokens ?? PACKAGE_MAX_TOKENS;
  // A strict rank prefix: the first object that does not fit ends the package, so nothing
  // lower-ranked ever displaces something higher-ranked.
  const kept: T[] = [];
  let tokens = 0;
  let i = 0;
  for (; i < ranked.length; i++) {
    const item = ranked[i]!;
    if (kept.length >= maxObjects || tokens + item.tokens > maxTokens) break;
    kept.push(item);
    tokens += item.tokens;
  }
  return { kept, dropped: ranked.slice(i), tokens };
}
