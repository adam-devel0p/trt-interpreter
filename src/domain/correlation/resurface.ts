/**
 * Feedback → confidence (docs/ALGORITHMS.md §3, spec §19). A rejected link is remembered:
 * it comes back only when the evidence is *materially* new — a different fingerprint that
 * scores at least RESUGGEST_DELTA higher than the rejected one, or a user-confirmed entity
 * or journey overlap that did not exist at the time of the rejection. An identical re-run
 * produces nothing (asserted by `rejected-link-not-resuggested`).
 */
import type { Correlation } from './score';
import { RESUGGEST_DELTA } from './thresholds';

export interface RejectedLink {
  state: 'pending' | 'confirmed' | 'maybe' | 'rejected';
  /** Score and fingerprint recorded at the rejection. */
  rejectedScore: number | null;
  rejectedFingerprint: string | null;
  /** Confirmed overlaps recorded at the rejection (from the stored `evidence`). */
  confirmedEntityIds: readonly string[];
  confirmedJourneyIds: readonly string[];
}

export type ResurfaceVerdict =
  | { resurface: true; reason: 'stronger_new_evidence' | 'confirmed_overlap' }
  | { resurface: false; reason: 'not_rejected' | 'same_evidence' | 'not_materially_stronger' };

export function shouldResurface(prev: RejectedLink, next: Correlation): ResurfaceVerdict {
  if (prev.state !== 'rejected') return { resurface: false, reason: 'not_rejected' };
  const newConfirmed =
    next.evidence.confirmedEntityIds.some((id) => !prev.confirmedEntityIds.includes(id)) ||
    next.evidence.confirmedJourneyIds.some((id) => !prev.confirmedJourneyIds.includes(id));
  if (newConfirmed) return { resurface: true, reason: 'confirmed_overlap' };
  if (prev.rejectedFingerprint !== null && next.fingerprint === prev.rejectedFingerprint)
    return { resurface: false, reason: 'same_evidence' };
  const floor = (prev.rejectedScore ?? 0) + RESUGGEST_DELTA;
  if (next.score + 1e-9 >= floor) return { resurface: true, reason: 'stronger_new_evidence' };
  return { resurface: false, reason: 'not_materially_stronger' };
}
