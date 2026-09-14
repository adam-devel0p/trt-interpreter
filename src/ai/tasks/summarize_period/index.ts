/**
 * summarize_period task (docs/AI_LAYER.md#task-catalogue, FR-20). Standard tier. Builds the
 * request from a bounded evidence package; the runner validates the versioned schema; the
 * caller verifies every citation and basis (`domain/summaries/provenance.ts`) and asks for
 * one repair with `repairHint` before giving up — an unverifiable summary is not stored.
 */
import type { MockEvidenceObject } from '../answer_from_evidence';
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type SummarizePeriodInput } from './prompt';
import { periodSummarySchema, type PeriodSummary } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { SummarizePeriodInput } from './prompt';
export { periodSummarySchema, type PeriodSummary } from './schema';

export function buildSummarizePeriodRequest(
  input: SummarizePeriodInput,
  opts: {
    userId: string;
    objectRefs: { type: string; id: string }[];
    mockObjects: MockEvidenceObject[];
  },
): ObjectRequest<PeriodSummary> {
  return {
    task: 'summarize_period',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: periodSummarySchema,
    maxTokens: 1600,
    userId: opts.userId,
    objectRefs: opts.objectRefs,
    mockInput: {
      kind: input.kind,
      periodLabel: input.periodLabel,
      start: input.start,
      end: input.end,
      objects: opts.mockObjects,
    },
  };
}

/** The repair turn after a failed verification: names the bad labels, never content. */
export function repairHint(issues: string[], stripped: string[]): string {
  const parts = ['Your previous summary could not be verified.'];
  if (stripped.length)
    parts.push(
      `These labels are not in the evidence package and must not be cited: ${stripped.join(', ')}.`,
    );
  if (issues.some((i) => i.startsWith('uncited')))
    parts.push(
      'Every claim needs at least one citation from the package; drop any claim you cannot cite.',
    );
  if (issues.some((i) => i.startsWith('unsupported_fact')))
    parts.push(
      'A claim with basis "confirmed_fact" must cite an entry that carries a recorded outcome, a logged life event or a confirmed connection; otherwise use "tarot_interpretation", "user_reflection" or "inferred".',
    );
  if (issues.some((i) => i.startsWith('register')))
    parts.push('Remove certainty language and percentages; hedge about meaning.');
  parts.push('If that leaves nothing to say, return empty sections and a plain headline.');
  return parts.join(' ');
}
