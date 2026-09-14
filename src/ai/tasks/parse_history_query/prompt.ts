import { LIFE_AREAS } from '@/domain/readings/types';
import { HISTORY_INTENTS } from '@/domain/retrieval/query';

/**
 * parse_history_query prompt (spec §8.1 step 1). The model turns one plain-language question
 * about the user's own history into structured hints: an intent, an absolute time range,
 * a life area, names of people / places / organisations, journey and card words, and — for
 * comparisons — the things being compared. Hints re-rank; they never invent evidence. The
 * question is the only user text in the prompt; no history is sent.
 */
export interface ParseHistoryQueryInput {
  question: string;
  /** ISO date; relative phrases ("since June", "last three months") resolve against it. */
  today: string;
}

export const SYSTEM = [
  'You turn a question someone asks about their own tarot journal into search hints. You do not answer the question and you know nothing about their history.',
  '',
  'Return one JSON object with exactly these keys:',
  `- intent: one of ${HISTORY_INTENTS.map((i) => `"${i}"`).join(', ')}. "change_over_time" = how something evolved; "recurring_cards" = which cards keep appearing; "compare" = two or more topics side by side; "outcome_check" = whether readings lined up with what later happened; "first_occurrence" = when something first showed up; "unresolved" = open questions or things not settled; "lookup" = find specific entries; "other" otherwise.`,
  '- time_range: {"start": "YYYY-MM-DD" or null, "end": "YYYY-MM-DD" or null} when the question names a period, otherwise null. Resolve relative phrases against today. "since June" is June 1st of the most recent June that is not in the future. Words like "old" or "early" are not a range.',
  `- life_area: one of ${LIFE_AREAS.map((a) => `"${a.key}"`).join(', ')} when the question is clearly about one, otherwise null.`,
  '- entity_hints: names of people, places or organisations exactly as written (e.g. "Maya", "Bali", "the agency"). Not tarot terms.',
  '- journey_hints: phrases that read like the name of an ongoing thread ("leaving my job", "the move").',
  '- card_hints: tarot card names mentioned, as written (any deck).',
  '- comparison_axes: for a comparison, the things compared, as written; otherwise [].',
  '- object_types: ["reading"] when the question is only about readings or cards, ["life_event"] when only about what happened, otherwise ["reading", "life_event"].',
  '- keywords: up to eight topic words from the question that would appear in a matching entry ("independence", "career", "job"). No stop words, no tarot terms, no names already in entity_hints.',
  '',
  "Rules: keep every list short; use the user's own spelling; when unsure about a field, leave it empty or null rather than guessing.",
].join('\n');

export function userPrompt(input: ParseHistoryQueryInput): string {
  return [`Today is ${input.today}.`, `Question: “${input.question}”`].join('\n');
}
