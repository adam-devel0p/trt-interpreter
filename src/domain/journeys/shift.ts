import { fnv1a } from '../extraction/hash';
import { SHIFT_MAX_AGE_DAYS } from '../summaries/thresholds';
import type { ProgressionStep } from './progression';

/**
 * Journey change detection (spec §15.2 "your last three readings shifted toward action").
 * A shift is the theme progression actually changing: its newest step carries a different
 * theme from the step before it. Each shift has a fingerprint (journey, the two themes, the
 * period the new step starts) so it is surfaced once: a re-run with the same progression
 * yields the same fingerprint and the caller, having recorded it, shows nothing. A shift
 * whose step ended more than `SHIFT_MAX_AGE_DAYS` ago is history, not news.
 */
export interface JourneyShift {
  journeyId: string;
  from: { slug: string; label: string };
  to: { slug: string; label: string };
  /** The objects that make the new step (the "last readings" the sentence points at). */
  sourceObjectIds: string[];
  periodStart: string;
  periodEnd: string;
  fingerprint: string;
}

export function detectShift(
  journeyId: string,
  steps: readonly ProgressionStep[],
  now: string = new Date().toISOString(),
): JourneyShift | null {
  if (steps.length < 2) return null;
  const ordered = [...steps].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const last = ordered[ordered.length - 1]!;
  const prev = ordered[ordered.length - 2]!;
  if (last.slug === prev.slug) return null;
  const ageDays = (Date.parse(now) - Date.parse(`${last.periodEnd}T23:59:59Z`)) / 86_400_000;
  if (ageDays > SHIFT_MAX_AGE_DAYS) return null;
  return {
    journeyId,
    from: { slug: prev.slug, label: prev.label },
    to: { slug: last.slug, label: last.label },
    sourceObjectIds: [...last.sourceObjectIds],
    periodStart: last.periodStart,
    periodEnd: last.periodEnd,
    fingerprint: fnv1a(`${journeyId}|${prev.slug}>${last.slug}|${last.periodStart}`),
  };
}

/** Sentence for the card: hedged, from the data, never a verdict. */
export function shiftSentence(shift: JourneyShift, journeyTitle: string): string {
  const n = shift.sourceObjectIds.length;
  return `Your last ${n === 1 ? 'entry' : `${n} entries`} in “${journeyTitle}” moved from ${shift.from.label.toLowerCase()} toward ${shift.to.label.toLowerCase()}.`;
}
