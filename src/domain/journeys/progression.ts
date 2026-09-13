/**
 * Theme progression (docs/ALGORITHMS.md §2, FR-17): bucket a journey's objects into periods
 * (weekly when dense, monthly when sparse), take the top themes per bucket by weight, collapse
 * consecutive duplicates, drop steps without enough support, and keep `sourceObjectIds` on
 * every step — a step without evidence is not representable. Rendered as a labelled
 * sequence, never a chart (§4.3).
 */
import {
  PROGRESSION_DENSE_PER_WEEK,
  PROGRESSION_MIN_SUPPORT,
  PROGRESSION_THEMES_PER_BUCKET,
} from './thresholds';

export interface ProgressionObject {
  id: string;
  occurredAt: string;
  themes: readonly { slug: string; label: string; weight: number }[];
}

export interface ProgressionStep {
  sequenceIndex: number;
  slug: string;
  label: string;
  /** `YYYY-MM-DD` (UTC) bounds of the period the step covers. */
  periodStart: string;
  periodEnd: string;
  sourceObjectIds: string[];
}

export type Bucketing = 'week' | 'month';

const DAY_MS = 86_400_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Weekly buckets when the journey averages ≥ PROGRESSION_DENSE_PER_WEEK objects a week. */
export function chooseBucketing(objects: readonly ProgressionObject[]): Bucketing {
  if (objects.length < 2) return 'month';
  const ts = objects.map((o) => Date.parse(o.occurredAt));
  const weeks = Math.max(1, (Math.max(...ts) - Math.min(...ts)) / (7 * DAY_MS));
  return objects.length / weeks >= PROGRESSION_DENSE_PER_WEEK ? 'week' : 'month';
}

function bucketKey(t: number, b: Bucketing): string {
  const d = new Date(t);
  if (b === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  // ISO-ish week: the Monday the instant falls after.
  const dow = (d.getUTCDay() + 6) % 7;
  return day(t - dow * DAY_MS);
}

function bucketBounds(key: string, b: Bucketing): { start: string; end: string } {
  if (b === 'month') {
    const [y, m] = key.split('-').map(Number) as [number, number];
    const start = Date.UTC(y, m - 1, 1);
    const end = Date.UTC(y, m, 0);
    return { start: day(start), end: day(end) };
  }
  const start = Date.parse(`${key}T00:00:00Z`);
  return { start: key, end: day(start + 6 * DAY_MS) };
}

export function themeProgression(
  objects: readonly ProgressionObject[],
  opts: { bucketing?: Bucketing; minSupport?: number; perBucket?: number } = {},
): ProgressionStep[] {
  const bucketing = opts.bucketing ?? chooseBucketing(objects);
  const minSupport = opts.minSupport ?? PROGRESSION_MIN_SUPPORT;
  const perBucket = opts.perBucket ?? PROGRESSION_THEMES_PER_BUCKET;
  const sorted = [...objects].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  // Bucket → slug → { label, weight sum, source ids }.
  const buckets = new Map<string, Map<string, { label: string; sum: number; sources: string[] }>>();
  for (const o of sorted) {
    const key = bucketKey(Date.parse(o.occurredAt), bucketing);
    const themes = buckets.get(key) ?? new Map();
    buckets.set(key, themes);
    const seen = new Set<string>();
    for (const t of o.themes) {
      if (seen.has(t.slug)) continue;
      seen.add(t.slug);
      const cur = themes.get(t.slug) ?? { label: t.label, sum: 0, sources: [] };
      cur.sum += t.weight;
      cur.sources.push(o.id);
      themes.set(t.slug, cur);
    }
  }

  // Top themes per bucket in order; then collapse consecutive duplicates across the sequence.
  const raw: Omit<ProgressionStep, 'sequenceIndex'>[] = [];
  for (const [key, themes] of [...buckets].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const { start, end } = bucketBounds(key, bucketing);
    const top = [...themes]
      .sort(([, a], [, b]) => b.sum - a.sum || a.label.localeCompare(b.label))
      .slice(0, perBucket);
    for (const [slug, t] of top)
      raw.push({
        slug,
        label: t.label,
        periodStart: start,
        periodEnd: end,
        sourceObjectIds: t.sources,
      });
  }
  const collapsed: Omit<ProgressionStep, 'sequenceIndex'>[] = [];
  for (const step of raw) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.slug === step.slug) {
      last.periodEnd = step.periodEnd;
      last.sourceObjectIds = [...new Set([...last.sourceObjectIds, ...step.sourceObjectIds])];
    } else {
      collapsed.push({ ...step, sourceObjectIds: [...step.sourceObjectIds] });
    }
  }
  return collapsed
    .filter((s) => s.sourceObjectIds.length >= minSupport)
    .map((s, i) => ({ sequenceIndex: i, ...s }));
}
