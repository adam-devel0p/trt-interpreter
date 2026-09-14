import { fnv1a } from '../extraction/hash';
import { ON_THIS_DAY_FALLBACK_DAYS, UNRESOLVED_REVIEW_MIN } from './thresholds';

/**
 * The retention surfaces (spec §15.2) as pure pickers. Each returns one thing or nothing:
 * nothing is invented to fill a slot (§4.7 no compulsive mechanics). Dismissal and
 * "once per shift" are the caller's memory (`retention_prompts`); these functions carry
 * the fingerprint that memory is keyed on.
 */

const DAY_MS = 86_400_000;
const dayOf = (iso: string) => iso.slice(0, 10);

// ── On this day / 30 days ago ──────────────────────────────────────────────────────────

export interface ResurfaceCandidate {
  id: string;
  occurredAt: string;
}

export interface Resurfacing {
  readingId: string;
  /** Anniversary in years, or 0 for the 30-days-ago fallback. */
  yearsAgo: number;
  fingerprint: string;
}

/**
 * One old reading for today: the same calendar day one or more years ago (the oldest
 * anniversary wins — it is the rarer thing to notice), else the reading from exactly
 * `ON_THIS_DAY_FALLBACK_DAYS` days ago. Nothing else qualifies; a reading from three weeks
 * ago is not "on this day", and a slot with nothing content-anchored stays empty.
 */
export function pickOnThisDay(
  readings: readonly ResurfaceCandidate[],
  today: string,
): Resurfacing | null {
  const t = today.slice(0, 10);
  const monthDay = t.slice(5);
  const year = Number(t.slice(0, 4));
  const anniversaries = readings
    .filter((r) => dayOf(r.occurredAt).slice(5) === monthDay)
    .map((r) => ({ r, years: year - Number(dayOf(r.occurredAt).slice(0, 4)) }))
    .filter((x) => x.years >= 1)
    .sort((a, b) => b.years - a.years || (a.r.occurredAt < b.r.occurredAt ? -1 : 1));
  const pick = anniversaries[0];
  if (pick)
    return {
      readingId: pick.r.id,
      yearsAgo: pick.years,
      fingerprint: fnv1a(`on_this_day|${pick.r.id}|${t}`),
    };
  const fallbackDay = dayOf(
    new Date(Date.parse(`${t}T12:00:00Z`) - ON_THIS_DAY_FALLBACK_DAYS * DAY_MS).toISOString(),
  );
  const thirty = readings
    .filter((r) => dayOf(r.occurredAt) === fallbackDay)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))[0];
  if (!thirty) return null;
  return { readingId: thirty.id, yearsAgo: 0, fingerprint: fnv1a(`on_this_day|${thirty.id}|${t}`) };
}

// ── Unresolved question review ─────────────────────────────────────────────────────────

export interface UnresolvedReading {
  id: string;
  occurredAt: string;
  /** Resolved entities the reading mentions: id + label. */
  entities: readonly { id: string; label: string }[];
  /** Theme slugs with labels, strongest first. */
  themes: readonly { slug: string; label: string }[];
}

export interface UnresolvedReview {
  /** `entity:<id>` or `theme:<slug>`. */
  key: string;
  subject: string;
  readingIds: string[];
  fingerprint: string;
}

/**
 * "You've asked about X three times without resolving": the largest group of unresolved
 * readings sharing a resolved person or place, else a theme, with at least
 * `UNRESOLVED_REVIEW_MIN` members. The fingerprint covers the member set, so the review is
 * dismissed for that set and returns only when a further reading joins it.
 */
export function pickUnresolvedReview(
  readings: readonly UnresolvedReading[],
): UnresolvedReview | null {
  type Group = { key: string; subject: string; ids: Set<string>; latest: string };
  const groups = new Map<string, Group>();
  const touch = (key: string, subject: string, r: UnresolvedReading) => {
    const g = groups.get(key) ?? { key, subject, ids: new Set<string>(), latest: '' };
    g.ids.add(r.id);
    if (r.occurredAt > g.latest) g.latest = r.occurredAt;
    groups.set(key, g);
  };
  for (const r of readings) {
    for (const e of r.entities) touch(`entity:${e.id}`, e.label, r);
    // Only the strongest theme files a reading, so one broad theme does not swallow everything.
    const t = r.themes[0];
    if (t) touch(`theme:${t.slug}`, t.label, r);
  }
  const best = [...groups.values()]
    .filter((g) => g.ids.size >= UNRESOLVED_REVIEW_MIN)
    .sort(
      (a, b) =>
        // Entities before themes (a named subject is a more honest "X"), then size, then recency.
        Number(b.key.startsWith('entity:')) - Number(a.key.startsWith('entity:')) ||
        b.ids.size - a.ids.size ||
        (a.latest < b.latest ? 1 : -1),
    )[0];
  if (!best) return null;
  const ids = [...best.ids].sort();
  return {
    key: best.key,
    subject: best.subject,
    readingIds: ids,
    fingerprint: fnv1a(`unresolved|${best.key}|${ids.join(',')}`),
  };
}

// ── The Home slot: one thing at a time ─────────────────────────────────────────────────

export type InsightKind = 'journey_shift' | 'unresolved_review' | 'retrospective' | 'on_this_day';

/** Priority of the Home slot when several surfaces have something (spec §5: one insight). */
export const INSIGHT_PRIORITY: readonly InsightKind[] = [
  'journey_shift',
  'retrospective',
  'unresolved_review',
  'on_this_day',
];

export interface InsightCandidate<T = unknown> {
  kind: InsightKind;
  fingerprint: string;
  payload: T;
}

/**
 * The single insight to show: the highest-priority candidate whose fingerprint has not been
 * dismissed, subject to the user's switches. Nothing when every surface is empty, off or
 * dismissed — the slot then shows its honest empty state.
 */
export function pickInsight<T>(
  candidates: readonly InsightCandidate<T>[],
  opts: { enabled: Record<InsightKind, boolean>; dismissed: ReadonlySet<string> },
): InsightCandidate<T> | null {
  for (const kind of INSIGHT_PRIORITY) {
    if (!opts.enabled[kind]) continue;
    const c = candidates.find((x) => x.kind === kind && !opts.dismissed.has(x.fingerprint));
    if (c) return c;
  }
  return null;
}
