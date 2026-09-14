import type { SummaryKind } from './thresholds';

/**
 * Period arithmetic in UTC calendar terms. A period is `[start, end]` inclusive, as ISO
 * dates. Weeks are ISO weeks (Monday–Sunday) keyed `YYYY-Www`; months `YYYY-MM`; years
 * `YYYY`. Journey periods are the journey's own span and carry no key of this shape.
 */

export interface Period {
  kind: Exclude<SummaryKind, 'journey'>;
  /** `YYYY-MM`, `YYYY-Www` or `YYYY`. */
  key: string;
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

function isoWeekOf(t: number): { year: number; week: number } {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  // Thursday of this week decides the ISO year.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const year = d.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week =
    1 +
    Math.round(((d.getTime() - jan4) / DAY_MS - 3 + ((new Date(jan4).getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

function isoWeekStart(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return mondayOfWeek1 + (week - 1) * 7 * DAY_MS;
}

/** The period of the given kind that contains `date` (ISO date or instant). */
export function periodContaining(kind: Period['kind'], date: string): Period {
  const t = Date.parse(date.length === 10 ? `${date}T12:00:00Z` : date);
  if (kind === 'weekly') {
    const { year, week } = isoWeekOf(t);
    const start = isoWeekStart(year, week);
    return { kind, key: `${year}-W${pad(week)}`, start: day(start), end: day(start + 6 * DAY_MS) };
  }
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (kind === 'monthly') {
    const m = d.getUTCMonth();
    return {
      kind,
      key: `${y}-${pad(m + 1)}`,
      start: day(Date.UTC(y, m, 1)),
      end: day(Date.UTC(y, m + 1, 0)),
    };
  }
  return { kind, key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Parses a period key back into its period; null for an unknown shape. */
export function parsePeriodKey(key: string): Period | null {
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const [y, w] = key.split('-W').map(Number) as [number, number];
    if (w < 1 || w > 53) return null;
    const start = isoWeekStart(y, w);
    const p = periodContaining('weekly', day(start));
    return p.key === key ? p : null;
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const m = Number(key.slice(5, 7));
    if (m < 1 || m > 12) return null;
    return periodContaining('monthly', `${key}-01`);
  }
  if (/^\d{4}$/.test(key)) return periodContaining('yearly', `${key}-01-01`);
  return null;
}

/** The previous period of the same kind. */
export function previousPeriod(p: Period): Period {
  const before = Date.parse(`${p.start}T12:00:00Z`) - DAY_MS;
  return periodContaining(p.kind, day(before));
}

/** Whether the period has fully passed as of `today` (a summary is only for complete periods). */
export function isComplete(p: Period, today: string): boolean {
  return p.end < today.slice(0, 10);
}

/** Complete periods of a kind that end within the last `count` periods before `today`. */
export function recentCompletePeriods(
  kind: Period['kind'],
  today: string,
  count: number,
): Period[] {
  const out: Period[] = [];
  let p = periodContaining(kind, today);
  if (!isComplete(p, today)) p = previousPeriod(p);
  while (out.length < count) {
    out.push(p);
    p = previousPeriod(p);
  }
  return out;
}

/** Human label: "August 2026", "Week of 10 August 2026", "2026". */
export function periodLabel(p: Pick<Period, 'kind' | 'start'>): string {
  const d = new Date(`${p.start}T12:00:00Z`);
  if (p.kind === 'monthly')
    return d.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (p.kind === 'weekly')
    return `Week of ${d.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  return String(d.getUTCFullYear());
}

/** Whether an ISO date or instant falls inside the period. */
export function inPeriod(p: Pick<Period, 'start' | 'end'>, date: string): boolean {
  const d = date.slice(0, 10);
  return d >= p.start && d <= p.end;
}
