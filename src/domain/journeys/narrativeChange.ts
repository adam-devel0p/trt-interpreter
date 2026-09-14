import { fnv1a } from '../extraction/hash';
import { NARRATIVE_REFRESH_DAYS } from '../summaries/thresholds';

/**
 * When a journey's stored narrative (spec §6.5) is regenerated: on a material change — a
 * member joined or left, an outcome was confirmed — or after `NARRATIVE_REFRESH_DAYS`;
 * never on a view (§19). The fingerprint is over the live member id set and the confirmed
 * outcome count, so a rename, a reorder or a new theme weight does not cost a model call.
 */
export interface NarrativeState {
  fingerprint: string;
  generatedAt: string;
}

export function narrativeFingerprint(input: {
  memberIds: readonly string[];
  confirmedOutcomes: number;
}): string {
  const ids = [...new Set(input.memberIds)].sort();
  return fnv1a(`${ids.join(',')}|outcomes:${input.confirmedOutcomes}`);
}

export type NarrativeDecision =
  | { regenerate: false; reason: 'unchanged' }
  | { regenerate: true; reason: 'none' | 'changed' | 'aged' };

export function decideNarrative(
  stored: NarrativeState | null,
  fingerprint: string,
  now: string = new Date().toISOString(),
): NarrativeDecision {
  if (!stored) return { regenerate: true, reason: 'none' };
  if (stored.fingerprint !== fingerprint) return { regenerate: true, reason: 'changed' };
  const ageDays = (Date.parse(now) - Date.parse(stored.generatedAt)) / 86_400_000;
  if (ageDays >= NARRATIVE_REFRESH_DAYS) return { regenerate: true, reason: 'aged' };
  return { regenerate: false, reason: 'unchanged' };
}
