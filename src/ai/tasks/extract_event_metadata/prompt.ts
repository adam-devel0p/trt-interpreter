/**
 * extract_event_metadata prompt (spec §6.4, §7.2). The model reads one sentence a person
 * wrote about something that happened, and an optional note, and proposes the same
 * structured metadata a reading gets — people, places, organisations, themes, tone — plus an
 * event type and importance. It proposes; identity is resolved by `domain/entities/resolve.ts`
 * and nothing here becomes a fact beyond what the person already wrote.
 */
import { ENTITY_KINDS, EVENT_TYPE_KEYS, THEME_CATEGORIES } from '@/domain/extraction/schema';
import { CURATED_THEMES } from '@/domain/themes/taxonomy';
import { LIFE_AREAS } from '@/domain/readings/types';

export interface ExtractEventInput {
  description: string;
  note: string | null;
  occurred_on: string;
}

export const SYSTEM = [
  'You extract structured notes from a one-sentence journal entry about something that happened in one person’s life. You are a careful reader, not a fortune teller.',
  '',
  'Return one JSON object with exactly these keys:',
  `- life_area: one of ${LIFE_AREAS.map((a) => a.key).join(', ')}, or null when the text does not say.`,
  `- event_type: one of ${EVENT_TYPE_KEYS.join(', ')}, or null.`,
  '- importance: an integer 1–5 for how much weight the writer’s own words give it (1 passing, 5 life-changing), or null when the text gives no sense of it.',
  `- entities: people, organisations, places, projects or things the text refers to. For each: "mention" (the exact words used), "kind" (${ENTITY_KINDS.join(' | ')}), "confidence" 0–1, "relation" (the relationship the text states, or null), "context" (the clause it appears in, or null). Never list pronouns or the writer themselves. Never invent a name that is not in the text.`,
  `- themes: up to 5, each {"label", "category" (${THEME_CATEGORIES.join(' | ')}), "weight" 0–1}. Prefer these labels when they fit: ${CURATED_THEMES.map((t) => t.label).join(', ')}.`,
  '- event_mentions: the event itself and any other happening the text names, each {"text", "when"}.',
  '- goals, fears, decisions: short strings the text itself expresses; empty arrays otherwise.',
  '- timeframe: null (an event has happened; it has no horizon).',
  '- possibilities: an empty array (an event is not a question).',
  '- emotional_tone: one or two plain words for the feeling in the text, or null.',
  '- journey_candidates: up to 2 {"title", "confidence"} for an ongoing life subject this belongs to, only when the text supports one.',
  '- safety_flags: empty unless the text itself mentions self-harm, immediate danger, or a medical, legal or financial crisis; then the matching word.',
  '',
  'Rules: use only what the text says. No probabilities, no certainty, no advice. Empty arrays and null are correct answers when the text is thin.',
].join('\n');

export function userPrompt(input: ExtractEventInput): string {
  const lines = [
    `Date: ${input.occurred_on}`,
    '',
    `What happened, in their words: “${input.description}”`,
  ];
  lines.push(input.note ? `Note: “${input.note}”` : 'Note: (none)');
  return lines.join('\n');
}
