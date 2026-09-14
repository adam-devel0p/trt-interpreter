/**
 * answer_from_evidence task (docs/AI_LAYER.md#task-catalogue): step 6 of hybrid retrieval.
 * Deep tier. The request carries the bounded package only (§11 minimum context); the
 * pipeline verifies every citation after (`domain/retrieval/answer.ts`) and asks for one
 * repair with `repairHint` before degrading to "not enough evidence".
 */
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type AnswerFromEvidenceInput } from './prompt';
import { historyAnswerSchema, type HistoryAnswer } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { AnswerFromEvidenceInput } from './prompt';
export { historyAnswerSchema, type HistoryAnswer } from './schema';

/** What the mock answerer reasons over: the package as structure, never as prose. */
export interface MockEvidenceObject {
  label: string;
  type: 'reading' | 'life_event';
  date: string;
  title: string | null;
  noteExcerpt: string | null;
  lifeArea: string | null;
  cards: string[];
  themes: string[];
  entities: string[];
  journeys: string[];
  followUp: string | null;
  outcomes: { status: string; note: string | null; eventTitle: string | null }[];
  links: {
    state: 'confirmed' | 'maybe';
    otherType: 'reading' | 'life_event';
    otherTitle: string;
    otherDate: string;
  }[];
}

export function buildAnswerFromEvidenceRequest(
  input: AnswerFromEvidenceInput,
  opts: {
    userId: string;
    askId: string;
    objectRefs: { type: string; id: string }[];
    mockObjects: MockEvidenceObject[];
  },
): ObjectRequest<HistoryAnswer> {
  return {
    task: 'answer_from_evidence',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: historyAnswerSchema,
    modelHint: 'deep',
    maxTokens: 1400,
    userId: opts.userId,
    objectRefs: [{ type: 'ask', id: opts.askId }, ...opts.objectRefs],
    mockInput: { question: input.question, query: input.query, objects: opts.mockObjects },
  };
}

/** The repair turn after a failed verification: names the bad labels, never content. */
export function repairHint(issues: string[], stripped: string[]): string {
  const parts = ['Your previous answer could not be verified.'];
  if (stripped.length)
    parts.push(
      `These labels are not in the evidence package and must not be cited: ${stripped.join(', ')}.`,
    );
  if (issues.includes('uncited claim') || issues.includes('no cited claim'))
    parts.push(
      'Every claim needs at least one citation from the package; drop any claim you cannot cite.',
    );
  if (issues.some((i) => i.startsWith('register')))
    parts.push('Remove certainty language and percentages; hedge about meaning.');
  parts.push('If that leaves too little, set evidence_sufficient to false and say what was found.');
  return parts.join(' ');
}
