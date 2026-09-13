/**
 * Repeated-question detection (FR-25, §10; docs/ALGORITHMS.md#5). Deterministic: cosine
 * similarity over question embeddings, a 24-hour window, a threshold, and one nudge per
 * cluster per day. Never blocks, never shames, never counts.
 */

export const REPEAT_SIMILARITY = 0.9;
export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Prior near-identical asks needed before the nudge (the third ask triggers it). */
export const REPEAT_MIN_PRIOR = 2;

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface PriorAsk {
  /** Null when the question was typed but no reading was saved. */
  readingId: string | null;
  vector: readonly number[];
  askedAt: string;
  nudgeShownAt: string | null;
}

export interface RepeatVerdict {
  /** Near-identical prior asks in the window that became readings, newest first. */
  priorReadingIds: string[];
  similarCount: number;
  /** Show the nudge now. */
  nudge: boolean;
  /** Why not, when `nudge` is false. */
  reason: 'too_few' | 'nudged_today' | null;
}

export function decideRepeat(
  vector: readonly number[],
  priors: readonly PriorAsk[],
  now: Date,
): RepeatVerdict {
  const since = now.getTime() - REPEAT_WINDOW_MS;
  const similar = priors
    .filter((p) => Date.parse(p.askedAt) >= since)
    .filter((p) => cosineSimilarity(vector, p.vector) >= REPEAT_SIMILARITY)
    .sort((a, b) => Date.parse(b.askedAt) - Date.parse(a.askedAt));
  const withReadings = similar.filter((p) => p.readingId !== null);
  const priorReadingIds = [...new Set(withReadings.map((p) => p.readingId!))];
  if (withReadings.length < REPEAT_MIN_PRIOR) {
    return { priorReadingIds, similarCount: similar.length, nudge: false, reason: 'too_few' };
  }
  const nudgedRecently = similar.some(
    (p) => p.nudgeShownAt !== null && Date.parse(p.nudgeShownAt) >= since,
  );
  if (nudgedRecently) {
    return { priorReadingIds, similarCount: similar.length, nudge: false, reason: 'nudged_today' };
  }
  return { priorReadingIds, similarCount: similar.length, nudge: true, reason: null };
}

/** Stable, content-free key for "the same question text" (used to link an ask to its reading). */
export function normaliseQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}
