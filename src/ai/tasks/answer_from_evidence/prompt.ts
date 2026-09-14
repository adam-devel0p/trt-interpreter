import type { HistoryQuery } from '@/domain/retrieval/query';

/**
 * answer_from_evidence prompt (spec §8.1 step 6, §6.6, §19). The model answers a question
 * about the user's history from a bounded, labelled evidence package and nothing else. Every
 * claim cites labels; the pipeline verifies them (step 7). The register is reflective and
 * hedged; the answer is honest about thin evidence — "not enough evidence" with what *was*
 * found is a first-class answer, never a failure.
 */
export interface AnswerFromEvidenceInput {
  question: string;
  today: string;
  /** How the user scoped the question, in words ("all of your history", "the journey …"). */
  scopeDescription: string;
  query: HistoryQuery;
  /** The rendered evidence package (`domain/retrieval/evidence.ts`). */
  evidence: string;
  /** How many objects were ranked but left out of the package by the bound. */
  droppedCount: number;
}

export const SYSTEM = [
  'You help someone look back over their own tarot journal. They asked a question about their history; below is the evidence retrieved from it — readings, life events they logged, outcomes they recorded, and connections they confirmed. Each piece of evidence has a label like [E3].',
  '',
  'Return one JSON object:',
  '{"evidence_sufficient": true|false, "conclusion": "...", "claims": [{"text": "...", "citations": ["E3", "E7"]}], "found": "..." or null, "narrower_question": "..." or null}',
  '',
  'Rules — these matter more than being helpful:',
  '- Use only the evidence given. Never mention a reading, card, date, person or event that is not in the package. If the package does not contain what the question needs, set evidence_sufficient to false, write a one-sentence "conclusion" saying so, put what you did find in "found", and suggest a "narrower_question" the evidence could answer. That is a good answer.',
  '- Every claim must cite the labels it rests on. A claim with no citation is not allowed. Do not cite a label that is not in the package.',
  '- "conclusion" comes first and answers the question directly in one to three sentences. Then up to five specific "claims", each an observation the person can check by opening the cited entries. Prefer fewer, sharper claims.',
  '- Fields marked "(derived)" were produced by software from their words; say "the journal noted" or "was tagged", not "you said". Outcomes and confirmed connections are the person\'s own records and can be stated plainly. A connection marked "maybe" is a maybe.',
  '- Cards mean nothing on their own here: a card is evidence only that it was drawn. Say a card appeared, not what it foretold.',
  '- Hedge about meaning ("suggests", "may point to", "one way to read this") and be plain about facts (dates, what was recorded). No percentages, no accuracy claims, no "will", no "definitely", nothing supernatural.',
  '- Do not give advice. Do not diagnose. Medical, legal, financial or safety questions get the evidence and a note that a qualified person is the right source for the decision.',
  '- Write in the second person, warmly and specifically. Quote their own words where it helps. Refer to entries by date and question, not by label, inside the text.',
].join('\n');

export function userPrompt(input: AnswerFromEvidenceInput): string {
  const q = input.query;
  const hints = [
    `intent: ${q.intent}`,
    q.time_range ? `period: ${q.time_range.start ?? '…'} to ${q.time_range.end ?? '…'}` : null,
    q.life_area ? `life area: ${q.life_area}` : null,
    q.entity_hints.length ? `about: ${q.entity_hints.join(', ')}` : null,
    q.comparison_axes.length ? `comparing: ${q.comparison_axes.join(' vs ')}` : null,
  ].filter(Boolean);
  return [
    `Today is ${input.today}.`,
    `Scope: ${input.scopeDescription}.`,
    `Question: “${input.question}”`,
    `Parsed as: ${hints.join('; ')}.`,
    input.droppedCount > 0
      ? `Note: ${input.droppedCount} lower-ranked entries were left out of this package; do not assume nothing else exists.`
      : 'This is everything retrieval found for the question.',
    '',
    input.evidence.trim() ? 'Evidence:' : 'Evidence: none was found.',
    input.evidence,
  ].join('\n');
}
