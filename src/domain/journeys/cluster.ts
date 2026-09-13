/**
 * Journey creation (docs/ALGORITHMS.md §2 "Journey creation"). Pure clustering over the
 * user's unassigned objects in two passes: pairwise affinity ≥ 0.60 grows cliques that
 * become `active` journeys when ≥ 3 objects spanning ≥ 14 days share a resolved entity or a
 * stable theme pair (otherwise `suggested`); the leftovers are clustered again at the
 * suggestion floor (0.40 — a theme pair plus activity), and a shared entity or theme pair is
 * still required, so a single shared theme never becomes a journey.
 * A cluster that is not materially new evidence against a dismissed journey (every member
 * already sat in it) is dropped, so a dismissal is never re-suggested (§19).
 */
import { pairAffinity, type ObjectFeatures, type ScoreOptions } from './affinity';
import {
  CLUSTER_MIN_AFFINITY,
  CLUSTER_MIN_OBJECTS,
  CLUSTER_MIN_SPAN_DAYS,
  DISCOVERY_MAX_OBJECTS,
  SUGGEST_MIN_AFFINITY,
  SUGGEST_MIN_OBJECTS,
} from './thresholds';

export type ClusterStatus = 'active' | 'suggested';

export interface Cluster {
  memberIds: string[];
  /** Mean pairwise affinity across the cluster — the journey's `confidence`. */
  meanAffinity: number;
  /** Entities every member carries. */
  sharedEntityIds: string[];
  /** Theme slugs every member carries (a "stable pair" is two of these). */
  sharedThemeSlugs: string[];
  spanDays: number;
  status: ClusterStatus;
  /** Why this became a journey — sentences, no numbers. */
  reasons: string[];
}

export interface ClusterOptions extends ScoreOptions {
  /** Member sets of dismissed journeys; a cluster within one of them is not re-suggested. */
  dismissed?: readonly (readonly string[])[];
  /** Cap on objects considered (the newest are kept). */
  maxObjects?: number;
}

const DAY_MS = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;

function intersectAll(sets: readonly ReadonlySet<string>[]): string[] {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return [...first!].filter((x) => rest.every((s) => s.has(x)));
}

function spanDaysOf(members: readonly ObjectFeatures[]): number {
  const ts = members.map((m) => Date.parse(m.occurredAt));
  return (Math.max(...ts) - Math.min(...ts)) / DAY_MS;
}

/** Status of a member set (also used when the user splits or removes members). */
export function classifyCluster(
  members: readonly ObjectFeatures[],
  meanAffinity: number,
): Omit<Cluster, 'memberIds' | 'reasons'> {
  const sharedEntityIds = intersectAll(members.map((m) => new Set(m.entityIds)));
  const sharedThemeSlugs = intersectAll(members.map((m) => new Set(m.themes.map((t) => t.slug))));
  const spanDays = round(spanDaysOf(members));
  const strong =
    members.length >= CLUSTER_MIN_OBJECTS &&
    spanDays >= CLUSTER_MIN_SPAN_DAYS &&
    (sharedEntityIds.length > 0 || sharedThemeSlugs.length >= 2);
  return {
    meanAffinity,
    sharedEntityIds,
    sharedThemeSlugs,
    spanDays,
    status: strong ? 'active' : 'suggested',
  };
}

function reasonsFor(c: Omit<Cluster, 'memberIds' | 'reasons'>, n: number, opts: ScoreOptions) {
  const reasons: string[] = [];
  if (c.sharedEntityIds.length) {
    const names = c.sharedEntityIds.map(
      (e) => opts.entityLabels?.get(e) ?? 'the same person or place',
    );
    reasons.push(`Every entry mentions ${names.join(' and ')}`);
  }
  if (c.sharedThemeSlugs.length) {
    const labels = c.sharedThemeSlugs.slice(0, 3).map((s) => opts.themeLabels?.get(s) ?? s);
    reasons.push(
      `The same theme${labels.length > 1 ? 's' : ''} run${labels.length > 1 ? '' : 's'} through all of them: ${labels.join(', ')}`,
    );
  }
  if (c.spanDays >= CLUSTER_MIN_SPAN_DAYS) reasons.push('It kept coming up over weeks, not days');
  else reasons.push('These are close together in time');
  if (n === 2) reasons.push('Only two entries so far — a guess, not a pattern');
  return reasons;
}

/**
 * Find journeys among unassigned objects. Greedy: the strongest remaining pair seeds a
 * cluster, which grows by objects that clear the pairwise floor against *every* current
 * member, then the next strongest untouched pair seeds another. Deterministic for a given
 * input order. Two passes: the active floor first, then the suggestion floor over the rest.
 */
export function discoverClusters(
  objects: readonly ObjectFeatures[],
  opts: ClusterOptions = {},
): Cluster[] {
  const cap = opts.maxObjects ?? DISCOVERY_MAX_OBJECTS;
  const sorted = [...objects].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const pool = sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted;
  const n = pool.length;
  if (n < SUGGEST_MIN_OBJECTS) return [];

  const aff: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = pairAffinity(pool[i]!, pool[j]!, opts).score;
      aff[i]![j] = s;
      aff[j]![i] = s;
    }

  const taken = new Set<number>();
  const clusters: Cluster[] = [];
  const pass = (floor: number, suggestOnly: boolean) => {
    const edges: { i: number; j: number; s: number }[] = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (!taken.has(i) && !taken.has(j) && aff[i]![j]! >= floor)
          edges.push({ i, j, s: aff[i]![j]! });
    edges.sort((a, b) => b.s - a.s || a.i - b.i || a.j - b.j);
    for (const e of edges) {
      if (taken.has(e.i) || taken.has(e.j)) continue;
      const members = [e.i, e.j];
      let grew = true;
      while (grew) {
        grew = false;
        let best: { k: number; mean: number } | null = null;
        for (let k = 0; k < n; k++) {
          if (taken.has(k) || members.includes(k)) continue;
          const scores = members.map((m) => aff[m]![k]!);
          if (scores.some((s) => s < floor)) continue;
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (!best || mean > best.mean) best = { k, mean };
        }
        if (best) {
          members.push(best.k);
          grew = true;
        }
      }
      const feats = members.map((m) => pool[m]!);
      let sum = 0;
      let pairs = 0;
      for (let a = 0; a < members.length; a++)
        for (let b = a + 1; b < members.length; b++) {
          sum += aff[members[a]!]![members[b]!]!;
          pairs += 1;
        }
      const mean = round(pairs ? sum / pairs : 0);
      const shape = classifyCluster(feats, mean);
      // A suggestion still needs something shared; a lone theme in common is not a journey.
      if (suggestOnly && shape.sharedEntityIds.length === 0 && shape.sharedThemeSlugs.length < 2)
        continue;
      for (const m of members) taken.add(m);
      const ids = feats.map((f) => f.id);
      if (opts.dismissed?.some((d) => ids.every((id) => d.includes(id)))) continue;
      clusters.push({
        memberIds: feats
          .slice()
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
          .map((f) => f.id),
        ...shape,
        status: suggestOnly ? 'suggested' : shape.status,
        reasons: reasonsFor(shape, ids.length, opts),
      });
    }
  };
  pass(CLUSTER_MIN_AFFINITY, false);
  pass(SUGGEST_MIN_AFFINITY, true);
  return clusters;
}
