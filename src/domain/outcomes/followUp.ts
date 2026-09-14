/**
 * Outcomes (spec §6.4, FR-15). The five statuses a person can record, their display labels,
 * and how a reading's `follow_up_status` follows from what was recorded — so the two never
 * drift. Outcomes are append-only; the newest per target is current.
 */
import type { FollowUpStatus } from '../readings/types';

export const OUTCOME_STATUSES = [
  'happened',
  'partly',
  'did_not_happen',
  'unresolved',
  'irrelevant',
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const OUTCOME_LABEL: Record<OutcomeStatus, string> = {
  happened: 'It happened',
  partly: 'Partly',
  did_not_happen: 'It did not happen',
  unresolved: 'Still unresolved',
  irrelevant: 'No longer relevant',
};

/** Short form for chips and timelines. */
export const OUTCOME_SHORT: Record<OutcomeStatus, string> = {
  happened: 'happened',
  partly: 'partly',
  did_not_happen: 'did not happen',
  unresolved: 'unresolved',
  irrelevant: 'no longer relevant',
};

export const OUTCOME_NOTE_MAX = 1000;

/** A reading-level outcome maps one-to-one onto the follow-up status. */
export function followUpForOutcome(status: OutcomeStatus): FollowUpStatus {
  switch (status) {
    case 'happened':
    case 'did_not_happen':
      return 'resolved';
    case 'partly':
      return 'partly_resolved';
    case 'irrelevant':
      return 'not_relevant';
    case 'unresolved':
      return 'unresolved';
  }
}

export interface OutcomeState {
  /** The current reading-level outcome, if any. */
  reading: OutcomeStatus | null;
  /** Current outcome per open (not dismissed) possibility. */
  possibilities: { predictionId: string; status: OutcomeStatus | null }[];
}

/**
 * The follow-up status a reading should carry given its outcomes. A reading-level outcome
 * wins. Otherwise the possibilities decide: every one answered → resolved (or not relevant
 * when every answer is "no longer relevant"); some answered → partly resolved; none →
 * unchanged (null: the caller keeps whatever the user set by hand).
 */
export function syncedFollowUp(state: OutcomeState): FollowUpStatus | null {
  if (state.reading) return followUpForOutcome(state.reading);
  const answered = state.possibilities.filter((p) => p.status !== null);
  if (state.possibilities.length === 0 || answered.length === 0) return null;
  if (answered.length < state.possibilities.length) return 'partly_resolved';
  if (answered.every((p) => p.status === 'unresolved')) return 'unresolved';
  if (answered.every((p) => p.status === 'irrelevant')) return 'not_relevant';
  if (answered.some((p) => p.status === 'unresolved' || p.status === 'partly'))
    return 'partly_resolved';
  return 'resolved';
}
