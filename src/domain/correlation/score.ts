/**
 * Correlation scoring (docs/ALGORITHMS.md §3, spec §8.2, FR-12, FR-13). Pure: two evidence
 * bundles in, a score with per-signal contributions, plain-sentence reasons, a stable
 * evidence fingerprint and the guard verdict out. The model never scores a pair — it may
 * only explain a score this code computed (`explain_correlation`).
 *
 *   score = 0.30·journey_overlap + 0.25·entity_overlap + 0.20·semantic_similarity
 *         + 0.10·theme_overlap + 0.10·timeframe_fit + 0.05·temporal_proximity
 *         + 0.05·card_symbol_overlap
 *
 * A signal without data is *unavailable* and its weight is renormalised out (as Phase 07
 * did for `semantic_similarity`): the journey signal when either side is in no journey,
 * semantic similarity until Phase 09's vectors exist, the timeframe when the reading states
 * no horizon, cards when either side has none (every reading ↔ event pair).
 *
 * Guards (§8.2, §10, §19), each asserted by an invariant test:
 *   1. card overlap is never sufficient alone — ≥ 2 non-card signals above 0.2, one of them
 *      temporal (the timeframe or proximity): a connection is anchored in time;
 *   2. generated text is never evidence that something happened — entities and themes whose
 *      provenance is an interpretation or a summary are dropped before scoring (stronger
 *      than "never the sole evidence", and simpler to prove);
 *   3. zero candidates is a valid result (the runner says so plainly);
 *   4. at most three suggestions per new object (`selectSuggestions`).
 */
import { cosine, weightedJaccard } from '../journeys/affinity';
import { fnv1a } from '../extraction/hash';
import {
  CANDIDATE_WINDOW_DAYS,
  LIKELY,
  LIKELY_TEMPORAL_MIN,
  MAX_SUGGESTIONS,
  NON_CARD_SIGNAL_FLOOR,
  NON_CARD_SIGNALS_REQUIRED,
  POSSIBLE,
  PROXIMITY_TAU_DAYS,
  STORE_MIN,
  TENTATIVE_WEIGHT,
  TIMEFRAME_GRACE_MIN_DAYS,
  WEIGHTS,
} from './thresholds';

export type CorrelationObjectType = 'reading' | 'life_event';
/** Where a piece of evidence came from. Only the user's own words count (§10). */
export type Provenance = 'user_text' | 'interpretation' | 'period_summary';
export type EntityResolution = 'auto' | 'user' | 'tentative';

export interface EvidenceEntity {
  id: string;
  resolution: EntityResolution;
  /** The entity itself was confirmed by the user (pinned). */
  userConfirmed?: boolean;
  provenance?: Provenance;
}
export interface EvidenceTheme {
  slug: string;
  weight: number;
  provenance?: Provenance;
}
export interface EvidenceJourney {
  id: string;
  state: 'auto' | 'confirmed';
}
export interface Horizon {
  /** ISO dates (YYYY-MM-DD). */
  start: string;
  end: string;
  /** The words the horizon came from ("next month"), for the reason. */
  text: string | null;
}

/** What the engine knows about one object. Built by `src/correlation/features.ts`. */
export interface CorrelationObject {
  id: string;
  type: CorrelationObjectType;
  /** ISO instant. */
  occurredAt: string;
  entities: readonly EvidenceEntity[];
  themes: readonly EvidenceTheme[];
  /** Live journey memberships (auto or confirmed). */
  journeys: readonly EvidenceJourney[];
  /** Deck-native card identities (readings only). */
  cards?: readonly string[];
  /** The horizon a reading stated (readings only). */
  horizon?: Horizon | null;
  /** Retrieval-document vector (Phase 09); absent until then. */
  embedding?: readonly number[];
}

export type SignalName = keyof typeof WEIGHTS;
export type Signals = Record<SignalName, number>;
export type TimeframeRelation = 'inside' | 'near' | 'outside' | 'none';

export interface Evidence {
  sharedEntityIds: string[];
  sharedThemeSlugs: string[];
  sharedJourneyIds: string[];
  sharedCardKeys: string[];
  /** Shared entities where at least one side is user-linked or the entity is user-confirmed. */
  confirmedEntityIds: string[];
  /** Shared journeys where at least one membership is user-confirmed. */
  confirmedJourneyIds: string[];
  timeframe: TimeframeRelation;
  daysApart: number;
}

export interface Correlation {
  score: number;
  signals: Signals;
  /** Signals that had data; the others were renormalised out. */
  available: SignalName[];
  /** Plain sentences naming the evidence. No numbers. */
  reasons: string[];
  evidence: Evidence;
  /** Stable hash of the evidence set (§19 re-suggestion). */
  fingerprint: string;
  /** Guard 1 (and the score floor) — a pair that fails never becomes a suggestion. */
  eligible: boolean;
  guardFailures: string[];
}

export interface ScoreOptions {
  entityLabels?: ReadonlyMap<string, string>;
  themeLabels?: ReadonlyMap<string, string>;
  journeyTitles?: ReadonlyMap<string, string>;
  cardLabels?: ReadonlyMap<string, string>;
}

export type DisplayBand = 'hidden' | 'possible' | 'likely';

const DAY_MS = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;
const NON_CARD: readonly SignalName[] = (Object.keys(WEIGHTS) as SignalName[]).filter(
  (k) => k !== 'card_symbol_overlap',
);
const TEMPORAL: readonly SignalName[] = ['timeframe_fit', 'temporal_proximity'];

// ── Guard 2: evidence filtering ────────────────────────────────────────────────────────────

const GENERATED: ReadonlySet<Provenance> = new Set(['interpretation', 'period_summary']);

/** Drop anything a model wrote (§10): it is never evidence that a real event occurred. */
export function filterEvidence(o: CorrelationObject): CorrelationObject {
  return {
    ...o,
    entities: o.entities.filter((e) => !GENERATED.has(e.provenance ?? 'user_text')),
    themes: o.themes.filter((t) => !GENERATED.has(t.provenance ?? 'user_text')),
  };
}

// ── Signals ────────────────────────────────────────────────────────────────────────────────

const entityWeight = (e: EvidenceEntity) => (e.resolution === 'tentative' ? TENTATIVE_WEIGHT : 1);

/**
 * Shared entity weight over the smaller side's count of *resolved* entities (at least 1).
 * A tentative link on either side contributes TENTATIVE_WEIGHT, so "the same person,
 * tentatively" is half a signal — and a tentatively shared second entity can only add, never
 * lower, the score (normalising by weighted totals cancels the discount; normalising by the
 * raw count punishes the extra evidence).
 */
function entityOverlap(a: CorrelationObject, b: CorrelationObject): number {
  const wa = new Map<string, number>();
  const wb = new Map<string, number>();
  for (const e of a.entities) wa.set(e.id, Math.max(wa.get(e.id) ?? 0, entityWeight(e)));
  for (const e of b.entities) wb.set(e.id, Math.max(wb.get(e.id) ?? 0, entityWeight(e)));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const [id, w] of wa) if (wb.has(id)) shared += Math.min(w, wb.get(id)!);
  const resolved = (m: Map<string, number>) => [...m.values()].filter((w) => w >= 1).length;
  const denominator = Math.max(1, Math.min(resolved(wa), resolved(wb)));
  return Math.min(1, shared / denominator);
}

function themeOverlap(a: CorrelationObject, b: CorrelationObject): number {
  const ma = new Map<string, number>();
  const mb = new Map<string, number>();
  for (const t of a.themes) ma.set(t.slug, Math.max(ma.get(t.slug) ?? 0, t.weight));
  for (const t of b.themes) mb.set(t.slug, Math.max(mb.get(t.slug) ?? 0, t.weight));
  if (ma.size === 0 || mb.size === 0) return 0;
  return weightedJaccard(ma, mb);
}

function journeyOverlap(a: CorrelationObject, b: CorrelationObject): number | null {
  if (a.journeys.length === 0 || b.journeys.length === 0) return null;
  const ja = new Set(a.journeys.map((j) => j.id));
  const jb = new Set(b.journeys.map((j) => j.id));
  let shared = 0;
  for (const id of ja) if (jb.has(id)) shared += 1;
  return shared / Math.min(ja.size, jb.size);
}

function cardOverlap(a: CorrelationObject, b: CorrelationObject): number | null {
  if (!a.cards?.length || !b.cards?.length) return null;
  const ca = new Set(a.cards);
  const cb = new Set(b.cards);
  let shared = 0;
  for (const k of ca) if (cb.has(k)) shared += 1;
  return Math.min(1, shared / (ca.size + cb.size - shared));
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

/** exp(−days / τ). */
export function temporalProximity(days: number): number {
  return Math.exp(-days / PROXIMITY_TAU_DAYS);
}

const dayOf = (iso: string) => Math.floor(Date.parse(iso) / DAY_MS);

/**
 * 1 when the date falls inside the horizon; outside it, linear to 0 over a grace period as
 * long as the horizon itself (at least TIMEFRAME_GRACE_MIN_DAYS). Null when no horizon.
 */
export function timeframeFit(
  horizon: Horizon | null | undefined,
  at: string,
): { value: number; relation: TimeframeRelation } | null {
  if (!horizon) return null;
  const start = dayOf(horizon.start);
  const end = dayOf(horizon.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const day = dayOf(at);
  if (day >= start && day <= end) return { value: 1, relation: 'inside' };
  const distance = day < start ? start - day : day - end;
  const grace = Math.max(TIMEFRAME_GRACE_MIN_DAYS, end - start);
  const value = Math.max(0, 1 - distance / grace);
  return { value: round(value), relation: value > 0 ? 'near' : 'outside' };
}

/** The reading side of a pair (the one whose horizon applies); the earlier reading for two. */
function horizonHolder(
  a: CorrelationObject,
  b: CorrelationObject,
): [CorrelationObject, CorrelationObject] | null {
  if (a.type === 'reading' && b.type !== 'reading') return [a, b];
  if (b.type === 'reading' && a.type !== 'reading') return [b, a];
  if (a.type === 'reading' && b.type === 'reading')
    return Date.parse(a.occurredAt) <= Date.parse(b.occurredAt) ? [a, b] : [b, a];
  return null;
}

// ── Reasons ────────────────────────────────────────────────────────────────────────────────

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "The same day", "Two days apart", "About three weeks apart", "About two months apart". */
export function daysApartPhrase(days: number): string {
  const d = Math.round(days);
  const WORDS = [
    'no',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ];
  const word = (n: number) => WORDS[n] ?? String(n);
  if (d === 0) return 'The same day';
  if (d === 1) return 'A day apart';
  if (d < 7) return `${cap(word(d))} days apart`;
  if (d < 14) return 'About a week apart';
  if (d < 28) {
    const w = Math.round(d / 7);
    return `About ${word(w)} weeks apart`;
  }
  if (d < 365) {
    const m = Math.round(d / 30);
    return m === 1 ? 'About a month apart' : `About ${word(m)} months apart`;
  }
  return 'About a year apart';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Score ──────────────────────────────────────────────────────────────────────────────────

/** Score two objects. Symmetric except for the horizon, which belongs to the reading side. */
export function scorePair(
  rawA: CorrelationObject,
  rawB: CorrelationObject,
  opts: ScoreOptions = {},
): Correlation {
  const a = filterEvidence(rawA);
  const b = filterEvidence(rawB);
  const days = daysBetween(a.occurredAt, b.occurredAt);

  const journey = journeyOverlap(a, b);
  const cards = cardOverlap(a, b);
  const holder = horizonHolder(a, b);
  const tf = holder ? timeframeFit(holder[0].horizon, holder[1].occurredAt) : null;
  const sem =
    a.embedding && b.embedding && a.embedding.length && b.embedding.length
      ? Math.max(0, cosine(a.embedding, b.embedding))
      : null;

  const signals: Signals = {
    journey_overlap: journey ?? 0,
    entity_overlap: round(entityOverlap(a, b)),
    semantic_similarity: sem === null ? 0 : round(sem),
    theme_overlap: round(themeOverlap(a, b)),
    timeframe_fit: tf?.value ?? 0,
    temporal_proximity: round(temporalProximity(days)),
    card_symbol_overlap: cards ?? 0,
  };
  const unavailable = new Set<SignalName>();
  if (journey === null) unavailable.add('journey_overlap');
  if (sem === null) unavailable.add('semantic_similarity');
  if (tf === null) unavailable.add('timeframe_fit');
  if (cards === null) unavailable.add('card_symbol_overlap');
  const available = (Object.keys(WEIGHTS) as SignalName[]).filter((k) => !unavailable.has(k));
  const total = available.reduce((s, k) => s + WEIGHTS[k], 0);
  const score = round(available.reduce((s, k) => s + WEIGHTS[k] * signals[k], 0) / total);

  // Evidence sets (ids, for the fingerprint and §19).
  const idsA = new Map(a.entities.map((e) => [e.id, e]));
  const sharedEntityIds = [...new Set(b.entities.map((e) => e.id))]
    .filter((id) => idsA.has(id))
    .sort();
  const confirmedEntityIds = sharedEntityIds.filter((id) => {
    const ea = idsA.get(id)!;
    const eb = b.entities.find((e) => e.id === id)!;
    return (
      ea.resolution === 'user' ||
      eb.resolution === 'user' ||
      !!ea.userConfirmed ||
      !!eb.userConfirmed
    );
  });
  const slugsA = new Set(a.themes.map((t) => t.slug));
  const sharedThemeSlugs = [...new Set(b.themes.map((t) => t.slug))]
    .filter((s) => slugsA.has(s))
    .sort();
  const journeysA = new Map(a.journeys.map((j) => [j.id, j]));
  const sharedJourneyIds = [...new Set(b.journeys.map((j) => j.id))]
    .filter((id) => journeysA.has(id))
    .sort();
  const confirmedJourneyIds = sharedJourneyIds.filter(
    (id) =>
      journeysA.get(id)!.state === 'confirmed' ||
      b.journeys.find((j) => j.id === id)!.state === 'confirmed',
  );
  const cardsA = new Set(a.cards ?? []);
  const sharedCardKeys = [...new Set(b.cards ?? [])].filter((k) => cardsA.has(k)).sort();
  const evidence: Evidence = {
    sharedEntityIds,
    sharedThemeSlugs,
    sharedJourneyIds,
    sharedCardKeys,
    confirmedEntityIds,
    confirmedJourneyIds,
    timeframe: tf?.relation ?? 'none',
    daysApart: Math.round(days),
  };

  // Guards.
  const guardFailures: string[] = [];
  const strong = NON_CARD.filter(
    (k) => available.includes(k) && signals[k] > NON_CARD_SIGNAL_FLOOR,
  );
  if (strong.length < NON_CARD_SIGNALS_REQUIRED) guardFailures.push('card_overlap_alone');
  // A connection is anchored in time: the event falls in the reading's stated window or
  // close to it. Without this, two objects in the same journey about the same employer
  // pair up months apart (found on the demo journal).
  if (!TEMPORAL.some((k) => strong.includes(k))) guardFailures.push('no_temporal_anchor');
  if (days > CANDIDATE_WINDOW_DAYS) guardFailures.push('outside_window');
  if (score < STORE_MIN) guardFailures.push('below_store_min');

  // Reasons — sentences, no numbers.
  const reasons: string[] = [];
  if (sharedJourneyIds.length) {
    const titles = sharedJourneyIds
      .map((id) => opts.journeyTitles?.get(id))
      .filter(Boolean) as string[];
    reasons.push(
      titles.length
        ? `Both are part of ${list(titles.map((t) => `“${t}”`))}`
        : 'Both are part of the same journey',
    );
  }
  if (sharedEntityIds.length) {
    const tentative = sharedEntityIds.filter((id) => {
      const ea = idsA.get(id)!;
      const eb = b.entities.find((e) => e.id === id)!;
      return ea.resolution === 'tentative' || eb.resolution === 'tentative';
    });
    const names = sharedEntityIds.map(
      (id) => opts.entityLabels?.get(id) ?? 'the same person or place',
    );
    reasons.push(
      tentative.length === sharedEntityIds.length
        ? `Both may mention ${list([...new Set(names)])}`
        : `Both mention ${list([...new Set(names)])}`,
    );
  }
  if (sharedThemeSlugs.length) {
    const labels = sharedThemeSlugs.slice(0, 3).map((s) => opts.themeLabels?.get(s) ?? s);
    reasons.push(`Related themes: ${list(labels)}`);
  }
  if (tf && holder) {
    const words = holder[0].horizon?.text ? `“${holder[0].horizon.text}”` : 'stated';
    if (tf.relation === 'inside') reasons.push(`The reading’s ${words} window covers this date`);
    else if (tf.relation === 'near') reasons.push(`Just outside the reading’s ${words} window`);
  }
  if (sharedCardKeys.length) {
    const names = sharedCardKeys.map((k) => opts.cardLabels?.get(k)).filter(Boolean) as string[];
    reasons.push(
      names.length ? `The same cards came up: ${list(names)}` : 'The same cards came up',
    );
  }
  reasons.push(daysApartPhrase(days));

  return {
    score,
    signals,
    available,
    reasons,
    evidence,
    fingerprint: fingerprintOf(evidence),
    eligible: guardFailures.length === 0,
    guardFailures,
  };
}

/** Coarse proximity bucket, so a day's drift does not make "new evidence". */
function proximityBucket(days: number): string {
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  if (days <= 92) return 'quarter';
  return 'year';
}

/** Stable hash of the evidence set that produced a suggestion (§19). */
export function fingerprintOf(e: Evidence): string {
  return fnv1a(
    JSON.stringify({
      e: e.sharedEntityIds,
      t: e.sharedThemeSlugs,
      j: e.sharedJourneyIds,
      c: e.sharedCardKeys,
      tf: e.timeframe,
      p: proximityBucket(e.daysApart),
    }),
  );
}

// ── Display and selection ──────────────────────────────────────────────────────────────────

/**
 * Display band. "Likely" needs the score *and* a strong temporal signal (inside the stated
 * window, or within about a month): a shared journey and person alone reach the score for
 * anything in the same thread, and on the demo journal that read as more certain than the
 * evidence was. Without signals (a stored row from before they were kept) the score decides.
 */
export function bandFor(
  score: number,
  signals?: Pick<Signals, TemporalSignal> | null,
): DisplayBand {
  if (score < POSSIBLE) return 'hidden';
  if (score < LIKELY) return 'possible';
  if (!signals) return 'likely';
  const anchored =
    signals.timeframe_fit >= LIKELY_TEMPORAL_MIN ||
    signals.temporal_proximity >= LIKELY_TEMPORAL_MIN;
  return anchored ? 'likely' : 'possible';
}
export type TemporalSignal = 'timeframe_fit' | 'temporal_proximity';

export interface Scored<T> {
  candidate: T;
  correlation: Correlation;
}

/**
 * From every scored pair of one new object: the ones to store (eligible and ≥ STORE_MIN) and,
 * among the visible ones, the strongest MAX_SUGGESTIONS to offer. An empty `offer` is a
 * normal, honest result (guard 3).
 */
export function selectSuggestions<T>(scored: readonly Scored<T>[]): {
  store: Scored<T>[];
  offer: Scored<T>[];
} {
  const store = scored
    .filter((s) => s.correlation.eligible)
    .sort((x, y) => y.correlation.score - x.correlation.score);
  const offer = store
    .filter((s) => bandFor(s.correlation.score, s.correlation.signals) !== 'hidden')
    .slice(0, MAX_SUGGESTIONS);
  return { store, offer };
}
