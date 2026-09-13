/**
 * extract_reading_metadata prompt (spec §7.2, FR-08). The model reads the user's own words —
 * question, note, the cards as drawn — and proposes structured metadata: life area, mentions
 * of people/places/organisations, themes, possibilities, a timeframe. It proposes; it never
 * decides identity (that is `domain/entities/resolve.ts`) and never states a fact.
 */
import { ENTITY_KINDS, THEME_CATEGORIES } from '@/domain/extraction/schema';
import { CURATED_THEMES } from '@/domain/themes/taxonomy';
import { LIFE_AREAS } from '@/domain/readings/types';

export interface ExtractReadingInput {
  question: string | null;
  is_open_reflection: boolean;
  user_notes: string | null;
  /** The user's own choice, if they made one — a strong hint, not a constraint. */
  life_area: string | null;
  occurred_on: string;
  deck_name: string;
  spread_name: string;
  cards: { position_name: string; card_name: string; orientation: 'upright' | 'reversed' }[];
}

export const SYSTEM = [
  'You extract structured notes from a short tarot-journal entry written by one person about their own life. You are a careful reader, not a fortune teller.',
  '',
  'Return one JSON object with exactly these keys:',
  `- life_area: one of ${LIFE_AREAS.map((a) => a.key).join(', ')}, or null when the text does not say.`,
  `- entities: people, organisations, places, projects or things the text refers to. For each: "mention" (the exact words used, e.g. "my girlfriend", "Alex", "the agency", "Leeds"), "kind" (${ENTITY_KINDS.join(' | ')}), "confidence" 0–1, "relation" (the relationship the text states — partner, friend, colleague, manager, employer, parent, sibling, ex-partner… — or null), "context" (the clause it appears in, or null). Never list pronouns (she, he, they) or the writer themselves. Never invent a name that is not in the text.`,
  `- themes: up to 5, each {"label", "category" (${THEME_CATEGORIES.join(' | ')}), "weight" 0–1}. Prefer these labels when they fit: ${CURATED_THEMES.map((t) => t.label).join(', ')}. Use another short label only when none fits.`,
  '- event_mentions: things the text says happened or will happen, each {"text", "when"} (when may be null).',
  '- goals, fears, decisions: short strings the text itself expresses; empty arrays when it does not.',
  '- timeframe: {"start", "end", "text"} for a horizon the question names ("by Friday", "this spring"), ISO dates only when the text makes them certain, else null; the whole object null when there is none.',
  '- possibilities: up to 4 things the *question* is asking about as outcomes, each {"text", "category", "timeframe", "kind": "possibility"}. Phrase each as a possibility ("The offer may come through"), never as a prediction, never with a likelihood.',
  '- emotional_tone: one or two plain words for the feeling in the text, or null.',
  '- journey_candidates: up to 2 {"title", "confidence"} for an ongoing life subject this entry belongs to ("The move to Leeds"), only when the text supports one.',
  '- safety_flags: empty unless the text itself mentions self-harm, immediate danger, or a medical, legal or financial crisis; then the matching word.',
  '',
  'Rules: use only what the text says; the cards are context, not evidence about the person’s life. No probabilities, no certainty, no advice. Empty arrays and null are correct answers when the text is thin.',
].join('\n');

export function userPrompt(input: ExtractReadingInput): string {
  const lines: string[] = [];
  lines.push(`Date: ${input.occurred_on}`);
  lines.push(`Deck: ${input.deck_name} · Spread: ${input.spread_name}`);
  if (input.life_area) lines.push(`The writer filed this under: ${input.life_area}`);
  lines.push(
    `Cards: ${input.cards.map((c) => `${c.position_name}: ${c.card_name}${c.orientation === 'reversed' ? ' (reversed)' : ''}`).join('; ')}`,
  );
  lines.push('');
  lines.push(
    input.is_open_reflection || !input.question
      ? 'Question: (none — an open reflection)'
      : `Question: “${input.question}”`,
  );
  lines.push(input.user_notes ? `Note in their own words: “${input.user_notes}”` : 'Note: (none)');
  return lines.join('\n');
}
