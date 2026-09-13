/**
 * Journey affinity (docs/ALGORITHMS.md §2, spec §6.5, FR-10). Pure: plain feature records in,
 * a score with per-signal contributions and sentence reasons out. The model never decides
 * membership — it only proposes titles (`propose_journey`); everything here is deterministic
 * and fixture-tested at every threshold boundary.
 *
 *   affinity = 0.35·entity_overlap + 0.25·semantic_similarity + 0.20·theme_overlap
 *            + 0.10·question_similarity + 0.10·temporal_activity
 *
 * `semantic_similarity` needs retrieval-document vectors (Phase 09). Until both sides carry
 * one it is *unavailable* and its weight is renormalised out, the same way Phase 06 handled
 * the journey signal in entity resolution — the thresholds keep their meaning now and later.
 */
import {
  ACTIVE_DECAY_DAYS,
  ACTIVE_WINDOW_DAYS,
  AUTO_ASSIGN,
  CORE_ENTITY_SHARE,
  PENDING,
  WEIGHTS,
} from './thresholds';

export type ObjectType = 'reading' | 'life_event';

export interface ObjectTheme {
  slug: string;
  weight: number;
}

/** What affinity knows about one object. Built by `src/journeys/features.ts` from stored rows. */
export interface ObjectFeatures {
  id: string;
  type: ObjectType;
  /** ISO instant the object happened. */
  occurredAt: string;
  /** Resolved entities only: `auto` and `user` mentions, never tentative (§7.1). */
  entityIds: readonly string[];
  themes: readonly ObjectTheme[];
  /** The question as written, or null for an open reflection. Tokenised here. */
  question: string | null;
  /** Retrieval-document vector (Phase 09); absent until then. */
  embedding?: readonly number[];
}

export interface JourneyFeatures {
  id: string;
  members: readonly ObjectFeatures[];
}

export type SignalName = keyof typeof WEIGHTS;
export type Signals = Record<SignalName, number>;

export interface Affinity {
  score: number;
  signals: Signals;
  /** Signals that had data; the others were renormalised out. */
  available: SignalName[];
  /** Plain sentences naming the evidence (no numbers). Shown as "why?". */
  reasons: string[];
}

export interface ScoreOptions {
  /** Entity id → display label, for the reasons. */
  entityLabels?: ReadonlyMap<string, string>;
  /** Theme slug → display label, for the reasons. */
  themeLabels?: ReadonlyMap<string, string>;
}

export type AssignmentDecision = 'auto' | 'pending' | 'none';

const DAY_MS = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;

// ── Text ───────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(
  (
    'a an the and or but if then so of to in on at for from with about into over after before ' +
    'is are was were be been being am do does did doing have has had having will would should ' +
    'could can may might must shall i me my mine we us our you your he him his she her hers it ' +
    'its they them their this that these those what which who whom whose when where why how ' +
    'not no nor as by than too very just also there here up down out off again once any all ' +
    'each both more most some such only own same still yet ever never really now'
  ).split(/\s+/),
);

/** Lowercase word tokens without stopwords, lightly stemmed (plural / -ing / -ed). */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    const bare = w.replace(/'s$/, '').replace(/'/g, '');
    if (bare.length < 3 || STOP.has(bare)) continue;
    out.add(stem(bare));
  }
  return [...out];
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Σ min / Σ max over the union of keys. */
export function weightedJaccard(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (keys.size === 0) return 0;
  let min = 0;
  let max = 0;
  for (const k of keys) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max === 0 ? 0 : min / max;
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

// ── Journey profile ────────────────────────────────────────────────────────────────────────

export interface JourneyProfile {
  /** Entities recurring across the journey (share ≥ CORE_ENTITY_SHARE). */
  coreEntityIds: Set<string>;
  /** Every entity any member carries. */
  entityIds: Set<string>;
  /** slug → share of members carrying the theme (0–1). */
  themeShare: Map<string, number>;
  questionTokens: Set<string>[];
  dates: number[];
  centroid: number[] | null;
}

export function journeyProfile(j: JourneyFeatures): JourneyProfile {
  const n = j.members.length;
  const entityCount = new Map<string, number>();
  const carriers = new Map<string, number>();
  const questionTokens: Set<string>[] = [];
  const dates: number[] = [];
  let centroid: number[] | null = null;
  let vectors = 0;
  for (const m of j.members) {
    for (const e of new Set(m.entityIds)) entityCount.set(e, (entityCount.get(e) ?? 0) + 1);
    const seen = new Set<string>();
    for (const t of m.themes) {
      if (seen.has(t.slug)) continue;
      seen.add(t.slug);
      carriers.set(t.slug, (carriers.get(t.slug) ?? 0) + 1);
    }
    const q = tokenize(m.question);
    if (q.length) questionTokens.push(new Set(q));
    dates.push(Date.parse(m.occurredAt));
    if (m.embedding && m.embedding.length) {
      centroid ??= new Array<number>(m.embedding.length).fill(0);
      if (centroid.length === m.embedding.length) {
        for (let i = 0; i < centroid.length; i++) centroid[i]! += m.embedding[i]!;
        vectors += 1;
      }
    }
  }
  const coreMin = Math.max(1, Math.ceil(n * CORE_ENTITY_SHARE));
  const coreEntityIds = new Set<string>();
  for (const [e, c] of entityCount) if (c >= coreMin) coreEntityIds.add(e);
  const themeShare = new Map<string, number>();
  for (const [slug, c] of carriers) themeShare.set(slug, c / n);
  if (centroid && vectors) centroid = centroid.map((x) => x / vectors);
  return {
    coreEntityIds,
    entityIds: new Set(entityCount.keys()),
    themeShare,
    questionTokens,
    dates,
    centroid: vectors ? centroid : null,
  };
}

// ── Signals ────────────────────────────────────────────────────────────────────────────────

/**
 * Overlap coefficient (|A ∩ B| / min |A|, |B|) between the object's resolved entities and
 * the journey's core, rather than a plain Jaccard: a reading that names Maya *and* Leeds is
 * as much about Maya as one that names Maya alone. Journal entries routinely name two or
 * three people; Jaccard filed those wrongly on the fixture arcs.
 */
function entityOverlap(o: ObjectFeatures, p: JourneyProfile): number {
  const mine = new Set(o.entityIds);
  if (mine.size === 0 || p.coreEntityIds.size === 0) return 0;
  let shared = 0;
  for (const e of mine) if (p.coreEntityIds.has(e)) shared += 1;
  return shared / Math.min(mine.size, p.coreEntityIds.size);
}

/**
 * How much of what this object is about the journey is also about: the object's theme
 * weights, each scaled by the share of the journey's members carrying that theme,
 * normalised by the object's total weight. Directional on purpose — a journey about many
 * things does not dilute a reading that shares its core theme; `pairAffinity` symmetrises.
 */
function themeOverlap(o: ObjectFeatures, p: JourneyProfile): number {
  const mine = new Map<string, number>();
  for (const t of o.themes) mine.set(t.slug, Math.max(mine.get(t.slug) ?? 0, t.weight));
  let total = 0;
  let shared = 0;
  for (const [slug, w] of mine) {
    total += w;
    shared += w * (p.themeShare.get(slug) ?? 0);
  }
  return total === 0 ? 0 : shared / total;
}

function questionSimilarity(o: ObjectFeatures, p: JourneyProfile): number {
  const q = new Set(tokenize(o.question));
  if (q.size === 0 || p.questionTokens.length === 0) return 0;
  let best = 0;
  for (const t of p.questionTokens) best = Math.max(best, jaccard(q, t));
  return best;
}

/** 1 within the active window of the nearest member; linear to 0 over the decay span. */
export function temporalActivity(at: string, dates: readonly number[]): number {
  if (dates.length === 0) return 0;
  const t = Date.parse(at);
  let gap = Infinity;
  for (const d of dates) gap = Math.min(gap, Math.abs(t - d) / DAY_MS);
  if (gap <= ACTIVE_WINDOW_DAYS) return 1;
  return Math.max(0, 1 - (gap - ACTIVE_WINDOW_DAYS) / ACTIVE_DECAY_DAYS);
}

function semanticSimilarity(o: ObjectFeatures, p: JourneyProfile): number | null {
  if (!o.embedding || !o.embedding.length || !p.centroid) return null;
  return Math.max(0, cosine(o.embedding, p.centroid));
}

// ── Score ──────────────────────────────────────────────────────────────────────────────────

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' });
}

/** Score one object against a journey (or, via `pairAffinity`, against another object). */
export function scoreAffinity(
  o: ObjectFeatures,
  j: JourneyFeatures,
  opts: ScoreOptions = {},
): Affinity {
  const p = journeyProfile(j);
  const sem = semanticSimilarity(o, p);
  const signals: Signals = {
    entity_overlap: entityOverlap(o, p),
    semantic_similarity: sem ?? 0,
    theme_overlap: themeOverlap(o, p),
    question_similarity: questionSimilarity(o, p),
    temporal_activity: temporalActivity(o.occurredAt, p.dates),
  };
  const available = (Object.keys(WEIGHTS) as SignalName[]).filter(
    (k) => k !== 'semantic_similarity' || sem !== null,
  );
  const total = available.reduce((s, k) => s + WEIGHTS[k], 0);
  const score = available.reduce((s, k) => s + WEIGHTS[k] * signals[k], 0) / total;

  const reasons: string[] = [];
  const sharedEntities = o.entityIds.filter((e) => p.coreEntityIds.has(e));
  if (sharedEntities.length) {
    const names = [...new Set(sharedEntities)].map(
      (e) => opts.entityLabels?.get(e) ?? 'the same person or place',
    );
    reasons.push(`Both mention ${list([...new Set(names)])}`);
  }
  const sharedThemes = [...new Set(o.themes.map((t) => t.slug))].filter((s) => p.themeShare.has(s));
  if (sharedThemes.length) {
    const labels = sharedThemes.slice(0, 3).map((s) => opts.themeLabels?.get(s) ?? s);
    reasons.push(
      sharedThemes.length === 1
        ? `Shares the theme ${labels[0]}`
        : `Shares the themes ${list(labels)}`,
    );
  }
  if (signals.question_similarity >= 0.34) {
    const nearest = j.members
      .filter((m) => m.question)
      .map((m) => ({ m, s: jaccard(new Set(tokenize(o.question)), new Set(tokenize(m.question))) }))
      .sort((a, b) => b.s - a.s)[0];
    if (nearest)
      reasons.push(`Asks something close to a question from ${monthOf(nearest.m.occurredAt)}`);
  }
  if (signals.temporal_activity >= 1) reasons.push('Happened while this was active');
  else if (signals.temporal_activity > 0)
    reasons.push('Happened not long after the last entry here');

  return { score: round(score), signals, available, reasons };
}

/**
 * Symmetric affinity between two objects: each scored as the other's one-member journey,
 * signals averaged (only theme overlap is directional), score recomputed.
 */
export function pairAffinity(
  a: ObjectFeatures,
  b: ObjectFeatures,
  opts: ScoreOptions = {},
): Affinity {
  const ab = scoreAffinity(a, { id: b.id, members: [b] }, opts);
  const ba = scoreAffinity(b, { id: a.id, members: [a] }, opts);
  const signals = { ...ab.signals };
  for (const k of Object.keys(signals) as SignalName[])
    signals[k] = round((ab.signals[k] + ba.signals[k]) / 2);
  const total = ab.available.reduce((s, k) => s + WEIGHTS[k], 0);
  const score = ab.available.reduce((s, k) => s + WEIGHTS[k] * signals[k], 0) / total;
  return { score: round(score), signals, available: ab.available, reasons: ab.reasons };
}

export function decideAssignment(score: number): AssignmentDecision {
  if (score >= AUTO_ASSIGN) return 'auto';
  if (score >= PENDING) return 'pending';
  return 'none';
}
