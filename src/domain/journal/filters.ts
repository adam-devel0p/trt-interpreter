/**
 * Journal filters (FR-21). Pure: the URL is the state — every filter round-trips through
 * `parseJournalParams` / `toSearchParams` so a filtered view is shareable and restorable, and
 * "clear" is one navigation. Keys are stable machine strings; labels live in the UI.
 */
import { z } from 'zod';
import { FOLLOW_UP_STATUSES, READING_SOURCES } from '@/domain/readings/types';

export const JOURNAL_SORTS = ['newest', 'oldest', 'edited'] as const;
export type JournalSort = (typeof JOURNAL_SORTS)[number];

export const JOURNAL_SORT_LABEL: Record<JournalSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  edited: 'Recently edited',
};

export const JOURNAL_PAGE_SIZE = 30;
export const QUERY_MAX = 200;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const journalFiltersSchema = z
  .object({
    /** Free text: FTS over question + notes, plus card names resolved through aliases. */
    q: z.string().trim().max(QUERY_MAX).default(''),
    /** Inclusive calendar day (the viewer's local day is applied by the caller). */
    from: isoDate.nullable().default(null),
    /** Inclusive calendar day. */
    to: isoDate.nullable().default(null),
    /** Deck slug. */
    deck: z.string().max(64).nullable().default(null),
    /** Spread id. */
    spread: z.string().uuid().nullable().default(null),
    /** Entity id (Phase 06): readings that mention this person, place or organisation. */
    entity: z.string().uuid().nullable().default(null),
    /** Journey id (Phase 07): live members of this journey. */
    journey: z.string().uuid().nullable().default(null),
    source: z.enum(READING_SOURCES).nullable().default(null),
    followUp: z.enum(FOLLOW_UP_STATUSES).nullable().default(null),
    hasNotes: z.boolean().nullable().default(null),
    hasInterpretation: z.boolean().nullable().default(null),
    sort: z.enum(JOURNAL_SORTS).default('newest'),
  })
  .strict();
export type JournalFilters = z.infer<typeof journalFiltersSchema>;

export const EMPTY_FILTERS: JournalFilters = journalFiltersSchema.parse({});

/** URL keys are short and stable; unknown or malformed values are dropped, never thrown. */
const URL_KEYS = {
  q: 'q',
  from: 'from',
  to: 'to',
  deck: 'deck',
  spread: 'spread',
  entity: 'entity',
  journey: 'journey',
  source: 'source',
  followUp: 'status',
  hasNotes: 'notes',
  hasInterpretation: 'ai',
  sort: 'sort',
} as const;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function first(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function bool(v: string | undefined): boolean | null {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

export function parseJournalParams(raw: RawParams): JournalFilters {
  const candidate = {
    q: first(raw, URL_KEYS.q) ?? '',
    from: first(raw, URL_KEYS.from) ?? null,
    to: first(raw, URL_KEYS.to) ?? null,
    deck: first(raw, URL_KEYS.deck) ?? null,
    spread: first(raw, URL_KEYS.spread) ?? null,
    entity: first(raw, URL_KEYS.entity) ?? null,
    journey: first(raw, URL_KEYS.journey) ?? null,
    source: first(raw, URL_KEYS.source) ?? null,
    followUp: first(raw, URL_KEYS.followUp) ?? null,
    hasNotes: bool(first(raw, URL_KEYS.hasNotes)),
    hasInterpretation: bool(first(raw, URL_KEYS.hasInterpretation)),
    sort: first(raw, URL_KEYS.sort) ?? 'newest',
  };
  // Field by field so one bad value drops only itself.
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(journalFiltersSchema.shape)) {
    const r = schema.safeParse(candidate[key as keyof typeof candidate]);
    out[key] = r.success ? r.data : (schema as z.ZodType).parse(undefined);
  }
  const parsed = out as JournalFilters;
  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    [parsed.from, parsed.to] = [parsed.to, parsed.from];
  }
  return parsed;
}

/** Only non-default values are written, so the bare `/journal` URL means "everything". */
export function toSearchParams(filters: Partial<JournalFilters>): URLSearchParams {
  const p = new URLSearchParams();
  const f = { ...EMPTY_FILTERS, ...filters };
  if (f.q) p.set(URL_KEYS.q, f.q);
  if (f.from) p.set(URL_KEYS.from, f.from);
  if (f.to) p.set(URL_KEYS.to, f.to);
  if (f.deck) p.set(URL_KEYS.deck, f.deck);
  if (f.spread) p.set(URL_KEYS.spread, f.spread);
  if (f.entity) p.set(URL_KEYS.entity, f.entity);
  if (f.journey) p.set(URL_KEYS.journey, f.journey);
  if (f.source) p.set(URL_KEYS.source, f.source);
  if (f.followUp) p.set(URL_KEYS.followUp, f.followUp);
  if (f.hasNotes !== null) p.set(URL_KEYS.hasNotes, f.hasNotes ? '1' : '0');
  if (f.hasInterpretation !== null)
    p.set(URL_KEYS.hasInterpretation, f.hasInterpretation ? '1' : '0');
  if (f.sort !== 'newest') p.set(URL_KEYS.sort, f.sort);
  return p;
}

export function journalHref(filters: Partial<JournalFilters>): string {
  const qs = toSearchParams(filters).toString();
  return qs ? `/journal?${qs}` : '/journal';
}

/** True when anything narrows the timeline (sort alone does not). */
export function hasActiveFilters(f: JournalFilters): boolean {
  return (
    f.q !== '' ||
    f.from !== null ||
    f.to !== null ||
    f.deck !== null ||
    f.spread !== null ||
    f.entity !== null ||
    f.journey !== null ||
    f.source !== null ||
    f.followUp !== null ||
    f.hasNotes !== null ||
    f.hasInterpretation !== null
  );
}

// ── Keyset cursor ─────────────────────────────────────────────────────────────────────────

export interface JournalCursor {
  /** The sort key of the last item on the page, exactly as the database returned it. */
  key: string;
  id: string;
}

const cursorSchema = z.object({ key: z.string().min(1).max(64), id: z.string().uuid() }).strict();

export function encodeCursor(c: JournalCursor): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(c)), 'utf8').toString('base64url');
}

/** Garbage in → null (the caller starts from the top), never an exception. */
export function decodeCursor(s: string | null | undefined): JournalCursor | null {
  if (!s) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    const r = cursorSchema.safeParse(parsed);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Which column the cursor key refers to for a sort. */
export function sortKeyOf(sort: JournalSort): 'occurred_at' | 'updated_at' {
  return sort === 'edited' ? 'updated_at' : 'occurred_at';
}

// ── Month grouping ────────────────────────────────────────────────────────────────────────

export interface MonthGroup<T> {
  /** `YYYY-MM` in the grouping zone. */
  key: string;
  label: string;
  items: T[];
}

/**
 * Groups items in order into months. `timeZone` defaults to UTC on the server; the list
 * re-groups in the viewer's zone after mount, the same way `LocalTime` does.
 */
export function groupByMonth<T>(
  items: readonly T[],
  at: (item: T) => string,
  opts: { timeZone?: string; locale?: string } = {},
): MonthGroup<T>[] {
  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: opts.timeZone ?? 'UTC',
  });
  const labelFmt = new Intl.DateTimeFormat(opts.locale ?? 'en', {
    year: 'numeric',
    month: 'long',
    timeZone: opts.timeZone ?? 'UTC',
  });
  const groups: MonthGroup<T>[] = [];
  for (const item of items) {
    const d = new Date(at(item));
    const key = keyFmt.format(d).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: labelFmt.format(d), items: [item] });
  }
  return groups;
}

/** The inclusive local-day range as UTC instants for the query (`to` is exclusive there). */
export function dayRangeToInstants(
  from: string | null,
  to: string | null,
  timeZone = 'UTC',
): { from: string | null; to: string | null } {
  return {
    from: from ? localMidnight(from, timeZone).toISOString() : null,
    to: to ? addDays(localMidnight(to, timeZone), 1).toISOString() : null,
  };
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Midnight of a calendar day in a zone, without a date library: probe the zone's offset. */
function localMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  if (timeZone === 'UTC') return new Date(guess);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asLocal = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  );
  return new Date(guess - (asLocal - guess));
}
