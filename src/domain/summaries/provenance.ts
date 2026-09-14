import { findRegisterViolations } from '../interpretation/register';
import {
  SUMMARY_SECTIONS,
  type JourneyNarrative,
  type PeriodSummary,
  type SummaryClaim,
  type SummarySection,
} from './schema';

/**
 * Provenance rules for generated summaries (spec §19 "journey summaries never cite a
 * model-generated summary as the sole evidence", §9.2, §21.7, §21.9).
 *
 *   1. `validateSources`: the set a summary is generated from is non-empty and is not made
 *      solely of other summaries or interpretations. The database rejects the empty set by
 *      check constraint; this is the application boundary the invariant test names.
 *   2. `verifySummary` / `verifyNarrative`: every citation is a label of the evidence package
 *      the model saw; unknown labels are stripped; a claim left without evidence is dropped;
 *      a "confirmed fact" that cites no confirmed evidence is dropped (it would be a fact the
 *      model made); every remaining text passes the hedged-register scan.
 */

export const SOURCE_TYPES = ['reading', 'life_event', 'period_summary', 'interpretation'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
/** Types that are generated text and can never carry a summary on their own. */
export const GENERATED_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  'period_summary',
  'interpretation',
]);

export interface SourceRef {
  type: SourceType;
  id: string;
}

export type SourceValidation =
  | { ok: true; sources: SourceRef[] }
  | { ok: false; reason: 'empty' | 'generated_only' | 'invalid' };

export function validateSources(sources: readonly SourceRef[]): SourceValidation {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sources) {
    if (!s || !SOURCE_TYPES.includes(s.type) || typeof s.id !== 'string' || !s.id)
      return { ok: false, reason: 'invalid' };
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: s.type, id: s.id });
  }
  if (out.length === 0) return { ok: false, reason: 'empty' };
  if (out.every((s) => GENERATED_SOURCE_TYPES.has(s.type)))
    return { ok: false, reason: 'generated_only' };
  return { ok: true, sources: out };
}

/** What the verifier needs to know about each label of the package. */
export interface LabelFacts {
  /** The label carries user-confirmed fact: a life event, an outcome, a confirmed connection. */
  confirmed: boolean;
}

export interface VerifiedSummary {
  summary: PeriodSummary;
  /** Labels cited that were not in the package. */
  stripped: string[];
  /** Claims removed: uncited after stripping, or a "confirmed fact" without confirmed evidence. */
  dropped: { section: SummarySection; reason: 'uncited' | 'unsupported_fact' | 'register' }[];
  /** At least one claim survived and the headline reads in the right register. */
  grounded: boolean;
  /** Content-free issue labels for the repair turn. */
  issues: string[];
}

function verifyClaim(
  claim: SummaryClaim,
  labels: ReadonlyMap<string, LabelFacts>,
  stripped: string[],
): { claim: SummaryClaim | null; reason?: 'uncited' | 'unsupported_fact' | 'register' } {
  const citations: string[] = [];
  for (const l of claim.citations) {
    if (labels.has(l)) {
      if (!citations.includes(l)) citations.push(l);
    } else stripped.push(l);
  }
  if (citations.length === 0) return { claim: null, reason: 'uncited' };
  if (claim.basis === 'confirmed_fact' && !citations.some((l) => labels.get(l)!.confirmed))
    return { claim: null, reason: 'unsupported_fact' };
  if (findRegisterViolations(claim.text).length) return { claim: null, reason: 'register' };
  return { claim: { text: claim.text, basis: claim.basis, citations } };
}

export function verifySummary(
  output: PeriodSummary,
  labels: ReadonlyMap<string, LabelFacts>,
): VerifiedSummary {
  const stripped: string[] = [];
  const dropped: VerifiedSummary['dropped'] = [];
  const summary: PeriodSummary = {
    headline: output.headline,
    recurred: [],
    shifted: [],
    open: [],
    confirmed: [],
  };
  for (const section of SUMMARY_SECTIONS) {
    for (const c of output[section]) {
      const v = verifyClaim(c, labels, stripped);
      if (v.claim) summary[section].push(v.claim);
      else dropped.push({ section, reason: v.reason! });
    }
  }
  const issues: string[] = [];
  if (stripped.length) issues.push(`unknown citation${stripped.length > 1 ? 's' : ''}`);
  for (const d of dropped) issues.push(`${d.reason} claim in ${d.section}`);
  for (const v of findRegisterViolations(summary.headline)) issues.push(`register: ${v.pattern}`);
  const claims = SUMMARY_SECTIONS.reduce((n, s) => n + summary[s].length, 0);
  if (claims === 0) issues.push('no cited claim');
  const grounded =
    claims > 0 && !issues.some((i) => i === 'no cited claim' || i.startsWith('register'));
  return { summary, stripped, dropped, grounded, issues };
}

export interface VerifiedNarrative {
  narrative: JourneyNarrative;
  stripped: string[];
  grounded: boolean;
  issues: string[];
}

export function verifyNarrative(
  output: JourneyNarrative,
  labels: ReadonlySet<string>,
): VerifiedNarrative {
  const stripped: string[] = [];
  const citations: string[] = [];
  for (const l of output.citations) {
    if (labels.has(l)) {
      if (!citations.includes(l)) citations.push(l);
    } else stripped.push(l);
  }
  const issues: string[] = [];
  if (stripped.length) issues.push(`unknown citation${stripped.length > 1 ? 's' : ''}`);
  if (citations.length === 0) issues.push('uncited sentence');
  for (const v of findRegisterViolations(output.sentence)) issues.push(`register: ${v.pattern}`);
  const progression = output.progression.map((p) => p.trim().toLowerCase()).filter(Boolean);
  const grounded = citations.length > 0 && !issues.some((i) => i.startsWith('register'));
  return {
    narrative: { sentence: output.sentence, progression, citations },
    stripped,
    grounded,
    issues,
  };
}

/** Every label a verified summary cites, in order of first appearance. */
export function summaryCitedLabels(summary: PeriodSummary): string[] {
  const out: string[] = [];
  for (const s of SUMMARY_SECTIONS)
    for (const c of summary[s]) for (const l of c.citations) if (!out.includes(l)) out.push(l);
  return out;
}

/** The claims of a summary flattened with their section, for rendering and export. */
export function summaryClaims(
  summary: PeriodSummary,
): (SummaryClaim & { section: SummarySection })[] {
  return SUMMARY_SECTIONS.flatMap((section) => summary[section].map((c) => ({ ...c, section })));
}
