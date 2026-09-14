import type { HistoryQuery } from './query';

/**
 * Step 3 of hybrid retrieval (docs/ALGORITHMS.md §4): the narrowed candidates are re-scored
 *
 *   final = 0.60·semantic + 0.20·structural_match + 0.15·recency + 0.05·confirmed_link_density
 *
 * As everywhere else in this codebase, a signal that is *unavailable* — no vector for the
 * candidate or the question, no hint of any kind in the parse — is left out and the weights
 * are renormalised over what is there, so a question with no hints ranks by similarity and
 * recency, and a failed embedding degrades to structure and recency (never nothing).
 * Structural match is the mean, over the hint kinds the parse gave, of how well the candidate
 * satisfies each; a hint the candidate misses costs rank, never recall — hints narrow only
 * when they are the user's explicit scope, and that happens in SQL before this runs.
 */

export const RANK_WEIGHTS = {
  semantic: 0.6,
  structural: 0.2,
  recency: 0.15,
  linkDensity: 0.05,
} as const;

/** Recency decays with e-folding time of a year; a "first occurrence" question inverts it. */
export const RECENCY_TAU_DAYS = 365;
/** Three confirmed connections saturate the link-density signal. */
export const LINK_DENSITY_SATURATION = 3;

export interface RankCandidate {
  id: string;
  type: 'reading' | 'life_event';
  /** ISO instant. */
  occurredAt: string;
  /** Cosine similarity to the question, or null when either side has no vector. */
  similarity: number | null;
  /** How many of the hinted entities the candidate mentions (resolved mentions only). */
  entityHits: number;
  journeyHit: boolean;
  cardHits: number;
  lifeAreaHit: boolean;
  /** Whether a topic keyword appears in the candidate's own words. */
  keywordHits: number;
  confirmedLinks: number;
}

export interface RankedCandidate extends RankCandidate {
  score: number;
  parts: {
    semantic: number | null;
    structural: number | null;
    recency: number;
    linkDensity: number;
  };
}

export interface RankContext {
  query: HistoryQuery;
  /** ISO instant "now"; recency is measured from here. */
  now: string;
  /** Resolved hint counts (how many entity / card hints actually matched something). */
  hinted: { entities: number; journeys: number; cards: number; keywords: number };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function structuralMatch(c: RankCandidate, ctx: RankContext): number | null {
  const parts: number[] = [];
  if (ctx.hinted.entities > 0) parts.push(clamp01(c.entityHits / ctx.hinted.entities));
  if (ctx.hinted.journeys > 0) parts.push(c.journeyHit ? 1 : 0);
  if (ctx.hinted.cards > 0) parts.push(clamp01(c.cardHits / ctx.hinted.cards));
  if (ctx.query.life_area) parts.push(c.lifeAreaHit ? 1 : 0);
  if (ctx.hinted.keywords > 0) parts.push(clamp01(c.keywordHits / ctx.hinted.keywords));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function recencyOf(occurredAt: string, now: string, intent: HistoryQuery['intent']): number {
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(occurredAt)) / 86_400_000);
  const r = Math.exp(-ageDays / RECENCY_TAU_DAYS);
  return intent === 'first_occurrence' ? 1 - r : r;
}

export function rankCandidates(
  candidates: readonly RankCandidate[],
  ctx: RankContext,
): RankedCandidate[] {
  const out = candidates.map((c): RankedCandidate => {
    const semantic = c.similarity === null ? null : clamp01(c.similarity);
    const structural = structuralMatch(c, ctx);
    const recency = recencyOf(c.occurredAt, ctx.now, ctx.query.intent);
    const linkDensity = clamp01(c.confirmedLinks / LINK_DENSITY_SATURATION);
    let weight = RANK_WEIGHTS.recency + RANK_WEIGHTS.linkDensity;
    let sum = RANK_WEIGHTS.recency * recency + RANK_WEIGHTS.linkDensity * linkDensity;
    if (semantic !== null) {
      weight += RANK_WEIGHTS.semantic;
      sum += RANK_WEIGHTS.semantic * semantic;
    }
    if (structural !== null) {
      weight += RANK_WEIGHTS.structural;
      sum += RANK_WEIGHTS.structural * structural;
    }
    return { ...c, score: sum / weight, parts: { semantic, structural, recency, linkDensity } };
  });
  // Stable: ties break by recency, then id, so a package is reproducible.
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
      a.id.localeCompare(b.id),
  );
}
