/**
 * The journey timeline (spec §6.5): interleaved chronological entries. Readings now; life
 * events and outcomes (Phase 08) are members of the same union, so they slot in without a
 * rewrite. Pure ordering and grouping; the rows come from the query layer.
 */
import { groupByMonth, type MonthGroup } from '@/domain/journal/filters';

export interface TimelineReading {
  kind: 'reading';
  id: string;
  at: string;
  question: string | null;
  isOpenReflection: boolean;
  deck: { system: 'rws' | 'thoth'; name: string };
  spread: string;
  cards: {
    cardId: string;
    name: string;
    orientation: 'upright' | 'reversed';
    positionName: string | null;
  }[];
  followUpStatus: string;
  revisitAt: string | null;
  membership: { state: 'auto' | 'pending' | 'confirmed'; reasons: string[] };
}

export interface TimelineEvent {
  kind: 'event';
  id: string;
  at: string;
  description: string;
}

export interface TimelineOutcome {
  kind: 'outcome';
  id: string;
  at: string;
  description: string;
  status: string;
}

export type TimelineEntry = TimelineReading | TimelineEvent | TimelineOutcome;

/** Newest first, ties by id, then grouped by month for sticky markers. */
export function buildTimeline(
  entries: readonly TimelineEntry[],
  opts: { timeZone?: string; locale?: string } = {},
): MonthGroup<TimelineEntry>[] {
  const sorted = [...entries].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1),
  );
  return groupByMonth(sorted, (e) => e.at, opts);
}

/** Unresolved follow-up, or a revisit date that has passed (spec §6.5 "Open loops"). */
export function isOpenLoop(
  r: { followUpStatus: string; revisitAt: string | null },
  now: string = new Date().toISOString(),
): boolean {
  if (r.followUpStatus === 'unresolved' || r.followUpStatus === 'partly_resolved') return true;
  return r.revisitAt !== null && Date.parse(r.revisitAt) <= Date.parse(now);
}
