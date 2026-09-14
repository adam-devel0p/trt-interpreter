import { z } from 'zod';
import { findRegisterViolations } from '../interpretation/register';

/**
 * `answer_from_evidence` output (docs/AI_LAYER.md#task-catalogue) and step 7 of hybrid
 * retrieval: citation verification. The schema *requires* citations — an answer is a
 * conclusion plus claims, and every claim names the evidence labels it rests on. The
 * verifier strips any label that is not in the package; a claim left without a citation, or
 * a "sufficient" answer with no cited claim at all, is not grounded and the caller
 * regenerates once, then degrades to "not enough evidence" rather than shipping an uncited
 * claim (§19). `evidence_sufficient: false` is a first-class answer (§6.6), not a failure.
 */

export const HISTORY_ANSWER_SCHEMA_VERSION = 'history_answer/1.0.0';

export const CITATION_LABEL = /^E\d{1,2}$/;

export const historyAnswerSchema = z
  .object({
    evidence_sufficient: z.boolean(),
    /** The answer in one to three sentences; shown first. */
    conclusion: z.string().trim().min(1).max(700),
    /** The specific observations behind the conclusion, each resting on named evidence. */
    claims: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(400),
            citations: z.array(z.string().regex(CITATION_LABEL)).max(8),
          })
          .strict(),
      )
      .max(8),
    /** When insufficient: what *was* found, in one sentence, so the state is honest. */
    found: z.string().trim().max(400).nullable(),
    /** When insufficient: a narrower question the evidence could answer. */
    narrower_question: z.string().trim().max(200).nullable(),
  })
  .strict();
export type HistoryAnswer = z.infer<typeof historyAnswerSchema>;

export interface VerifiedAnswer {
  answer: HistoryAnswer;
  /** Labels the model cited that were not in the package. */
  stripped: string[];
  /** Whether every claim rests on package evidence (and a sufficient answer has at least one). */
  grounded: boolean;
  /** Content-free issue labels for the repair turn. */
  issues: string[];
}

export function verifyAnswer(answer: HistoryAnswer, labels: ReadonlySet<string>): VerifiedAnswer {
  const stripped: string[] = [];
  const claims = answer.claims.map((c) => {
    const citations: string[] = [];
    for (const l of c.citations) {
      if (labels.has(l)) {
        if (!citations.includes(l)) citations.push(l);
      } else stripped.push(l);
    }
    return { text: c.text, citations };
  });
  const issues: string[] = [];
  if (stripped.length) issues.push(`unknown citation${stripped.length > 1 ? 's' : ''}`);
  if (answer.evidence_sufficient) {
    if (claims.length === 0) issues.push('no cited claim');
    if (claims.some((c) => c.citations.length === 0)) issues.push('uncited claim');
  }
  for (const v of findRegisterViolations(
    `${answer.conclusion} ${claims.map((c) => c.text).join(' ')}`,
  ))
    issues.push(`register: ${v.pattern}`);
  const grounded = !issues.some(
    (i) => i === 'no cited claim' || i === 'uncited claim' || i.startsWith('register'),
  );
  return { answer: { ...answer, claims }, stripped, grounded, issues };
}

/** The honest fallback when grounding fails twice (or the model did): shows what was found. */
export function insufficientAnswer(found: string | null, narrower: string | null): HistoryAnswer {
  return {
    evidence_sufficient: false,
    conclusion: 'There is not enough evidence in your history to answer this with confidence.',
    claims: [],
    found,
    narrower_question: narrower,
  };
}

/** Every label an answer cites, in order of first appearance. */
export function citedLabels(answer: HistoryAnswer): string[] {
  const out: string[] = [];
  for (const c of answer.claims) for (const l of c.citations) if (!out.includes(l)) out.push(l);
  return out;
}
