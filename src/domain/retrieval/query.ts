import { z } from 'zod';
import { LIFE_AREAS } from '../readings/types';

/**
 * Step 1 of hybrid retrieval (docs/ALGORITHMS.md §4): what `parse_history_query` returns.
 * A parse is hints, not answers — the only hard narrowing it can cause is the time range and
 * the content type; entity, journey, card and life-area hints are soft structural signals
 * that re-rank candidates (a wrong hint costs rank, never recall). Every list is bounded.
 *
 * `HISTORY_INTENTS` are stable keys (spec §13); labels live with the UI.
 */

export const HISTORY_INTENTS = [
  'change_over_time',
  'recurring_cards',
  'compare',
  'outcome_check',
  'first_occurrence',
  'unresolved',
  'lookup',
  'other',
] as const;
export type HistoryIntent = (typeof HISTORY_INTENTS)[number];

export const HISTORY_QUERY_SCHEMA_VERSION = 'history_query/1.0.0';

const LIFE_AREA_KEYS = LIFE_AREAS.map((a) => a.key) as [
  (typeof LIFE_AREAS)[number]['key'],
  ...(typeof LIFE_AREAS)[number]['key'][],
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hint = z.string().trim().min(1).max(80);

export const historyQuerySchema = z
  .object({
    intent: z.enum(HISTORY_INTENTS),
    /** Absolute dates (the prompt is told today's date); either end may be open. */
    time_range: z.object({ start: isoDate.nullable(), end: isoDate.nullable() }).nullable(),
    life_area: z.enum(LIFE_AREA_KEYS).nullable(),
    entity_hints: z.array(hint).max(6),
    journey_hints: z.array(hint).max(4),
    card_hints: z.array(hint).max(8),
    /** For comparisons: the things being compared, in the user's words ("Bali", "Thailand"). */
    comparison_axes: z.array(hint).max(4),
    /** Which kinds of object the question is about; both when unclear. */
    object_types: z
      .array(z.enum(['reading', 'life_event']))
      .min(1)
      .max(2),
    /** Topic words for the structural signal when nothing else resolves. */
    keywords: z.array(hint).max(8),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const EMPTY_QUERY: HistoryQuery = {
  intent: 'other',
  time_range: null,
  life_area: null,
  entity_hints: [],
  journey_hints: [],
  card_hints: [],
  comparison_axes: [],
  object_types: ['reading', 'life_event'],
  keywords: [],
};

/** What the user chose on the composer (spec §6.6 scope chips). Ids are checked at load. */
export const askScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('journey'), journeyId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('entity'), entityId: z.string().uuid() }).strict(),
  z
    .object({ kind: z.literal('range'), start: isoDate.nullable(), end: isoDate.nullable() })
    .strict(),
]);
export type AskScope = z.infer<typeof askScopeSchema>;

export const ASK_QUESTION_MAX = 300;
export const askQuestionSchema = z.string().trim().min(3).max(ASK_QUESTION_MAX);

/** The composer's example questions (spec §6.6), verbatim. */
export const EXAMPLE_QUESTIONS = [
  'How have my relationship readings changed since June?',
  'What cards keep appearing when I ask about leaving my job?',
  'Compare my readings about Bali and Thailand.',
  'Did any of my old career readings line up with what later happened?',
  'When did I first start getting themes of independence?',
  'What questions do I keep asking without resolving?',
] as const;

// ── Relative time phrases → absolute dates (used by the mock parser and as a fallback) ──

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/**
 * Resolves phrases like "since June", "in January", "last three months", "this year" against
 * `today` (an ISO date). A month in the future means last year's. Returns null when the
 * question carries no time phrase — "old readings" is not a range.
 */
export function resolveTimePhrase(
  question: string,
  today: string,
): { start: string | null; end: string | null } | null {
  const now = new Date(`${today}T00:00:00Z`);
  const y = now.getUTCFullYear();
  const q = question.toLowerCase();
  const monthIdx = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.slice(0, 3)));
  const yearOf = (m: number) => (utc(y, m, 1) > now ? y - 1 : y);

  const since = q.match(
    /\bsince\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (since) {
    const m = monthIdx(since[1]!);
    return { start: iso(utc(yearOf(m), m, 1)), end: null };
  }
  const inMonth = q.match(
    /\b(?:in|during|from)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (inMonth) {
    const m = monthIdx(inMonth[1]!);
    const yy = yearOf(m);
    return { start: iso(utc(yy, m, 1)), end: iso(utc(yy, m + 1, 0)) };
  }
  const lastN = q.match(/\b(?:last|past)\s+(\w+)\s+(day|week|month|year)s?\b/);
  if (lastN) {
    const words: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      twelve: 12,
      few: 3,
      couple: 2,
    };
    const n = words[lastN[1]!] ?? Number(lastN[1]);
    if (Number.isFinite(n) && n > 0) {
      const unit = lastN[2]!;
      const start =
        unit === 'day'
          ? utc(y, now.getUTCMonth(), now.getUTCDate() - n)
          : unit === 'week'
            ? utc(y, now.getUTCMonth(), now.getUTCDate() - 7 * n)
            : unit === 'month'
              ? utc(y, now.getUTCMonth() - n, now.getUTCDate())
              : utc(y - n, now.getUTCMonth(), now.getUTCDate());
      return { start: iso(start), end: null };
    }
  }
  const season = q.match(/\b(this|last)\s+(spring|summer|autumn|fall|winter)\b/);
  if (season) {
    const spans: Record<string, [number, number]> = {
      spring: [2, 4],
      summer: [5, 7],
      autumn: [8, 10],
      fall: [8, 10],
      winter: [11, 13],
    };
    const [m0, m1] = spans[season[2]!]!;
    let yy = season[1] === 'last' ? y - 1 : y;
    if (season[1] === 'this' && utc(yy, m0, 1) > now) yy -= 1;
    return { start: iso(utc(yy, m0, 1)), end: iso(utc(yy, m1 + 1, 0)) };
  }
  if (/\bthis year\b/.test(q)) return { start: `${y}-01-01`, end: null };
  if (/\blast year\b/.test(q)) return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  if (/\bthis (?:month)\b/.test(q)) return { start: iso(utc(y, now.getUTCMonth(), 1)), end: null };
  if (/\bthis (?:week)\b/.test(q))
    return { start: iso(utc(y, now.getUTCMonth(), now.getUTCDate() - 7)), end: null };
  return null;
}
