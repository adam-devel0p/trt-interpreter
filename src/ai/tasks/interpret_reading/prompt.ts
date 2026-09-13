/**
 * interpret_reading prompt (spec §9.3, §6.2 step 8; docs/AI_LAYER.md#prompt-construction-rules).
 *
 * The system prompt is stable per deck system and depth (cacheable); the user turn carries the
 * reading. Every rule from AI_LAYER.md is stated to the model *and* enforced after generation
 * (deck purity, register, position coverage), so the prompt is the first line, never the only one.
 */
import type { DeckSystem } from '@/domain/decks/types';
import type { DepthPlan } from '@/domain/interpretation/depth';
import {
  NUANCES_MAX,
  PROMPTS_MAX,
  PROMPTS_MIN,
  SYNTHESIS_MAX,
} from '@/domain/interpretation/schema';
import type { SafetyClassification } from '@/domain/safety/categories';

export interface InterpretCardInput {
  position_index: number;
  position_name: string;
  position_prompt: string;
  card_id: string;
  name: string;
  title: string | null;
  arcana: 'major' | 'minor';
  suit_label: string | null;
  rank_label: string | null;
  numeral: string | null;
  number: number | null;
  element: string | null;
  astrology: string | null;
  correspondences: Record<string, unknown>;
  orientation: 'upright' | 'reversed';
  /** Keywords and meaning for this orientation, from the deck's own reference row. */
  keywords: string[];
  meaning: string;
  /** True when the card is reversed but the deck carries no reversed text. */
  reversed_without_text: boolean;
}

export interface InterpretReadingInput {
  question: string | null;
  is_open_reflection: boolean;
  life_area: string | null;
  deck: { name: string; system: DeckSystem; tradition_notes: string; supports_reversals: boolean };
  spread: { name: string; description: string | null };
  cards: InterpretCardInput[];
  user_notes: string | null;
  depth: DepthPlan;
  safety: SafetyClassification;
  /** Terms from the other deck system that must not appear (for the prompt's explicit list). */
  forbidden_terms_sample: string[];
}

const DECK_RULES: Record<DeckSystem, string> = {
  rws: 'This reading uses the Rider–Waite–Smith deck. Use only its names: the court is Page, Knight, Queen, King; the earth suit is Pentacles; the trumps are Strength, Justice, Temperance, Judgement, The World, The Magician, The High Priestess, Wheel of Fortune. Reversals are meaningful in this deck when the reading uses them. Never use Thoth names, titles or court terms, and do not mention the Thoth deck.',
  thoth:
    'This reading uses the Thoth deck (Crowley / Harris). Use only its names: the trumps are Atu and several carry Crowley’s names (Adjustment, Lust, Art, The Aeon, The Universe, The Magus, The Priestess, Fortune); the court is Knight, Queen, Prince, Princess; the earth suit is Disks; small cards carry titles (e.g. Dominion, Virtue, Ruin). The deck is read by elemental dignity and position, not by reversal. Never use Rider–Waite–Smith names, court terms or suit names, and do not mention the Rider–Waite–Smith deck.',
};

export function systemPrompt(input: InterpretReadingInput): string {
  const d = input.depth;
  const experienced = d.experienced
    ? ' The reader is experienced: be concise, skip basics, and never restate a card’s textbook meaning at length — their own reading leads and yours adds to it.'
    : '';
  const safety =
    input.safety.category !== 'none'
      ? `\n\nThe question touches a high-stakes topic (${input.safety.category.replace('_', ' ')}). Keep the reflection: read the cards in position as usual, gently, without alarm. Do not give medical, legal or financial advice, do not assess risk, and do not lecture; the app shows real-world resources separately.`
      : '';
  return [
    'You interpret tarot readings for a private, reflective journal. The person is not asking for a prediction; they are thinking something through, and the cards are a mirror for that. Your job is to help them see their situation from the cards’ angle, specifically and warmly, in plain language.',
    '',
    DECK_RULES[input.deck.system],
    '',
    'Rules:',
    '1. Ground every statement in the reference material supplied for each drawn card (its keywords, meaning and correspondences). Do not rely on your own recollection of card meanings; if the reference does not support a claim, do not make it.',
    '2. Interpret each card in its named spread position using the position’s prompt. Never give a standalone card meaning; say what this card in this position suggests about this question.',
    '3. The person’s words lead. Quote or closely paraphrase their question and, when present, their own note. Never contradict, correct or replace what they noticed — build on it, and if the cards suggest a different angle, offer it as an addition.',
    '4. Hedged register throughout: “suggests”, “may point to”, “one way to read this”, “you might ask yourself”. Never predict outcomes, never state that something will happen, never give percentages, odds, certainty or accuracy claims, and never tell the person what they must do.',
    '5. Where a card’s symbolism is genuinely ambiguous in this position, give one plausible alternative reading in the nuances rather than pretending to certainty.',
    '6. Be specific to this question, these cards and these positions. No fortune-cookie generalities, no filler, no mystical grandiosity, no emoji.',
    `7. Length: each per-card text is ${d.perCardSentences}; the combined reading is ${d.combinedSentences}; the synthesis is one sentence of at most ${SYNTHESIS_MAX} characters; at most ${Math.min(d.nuancesMax, NUANCES_MAX)} nuances per card; ${PROMPTS_MIN}–${PROMPTS_MAX} reflective prompts, each a single open question the person could sit with.${experienced}`,
    '8. Second person, unhurried, concrete. Refer to cards by their deck-native names exactly as given.',
    safety,
    '',
    'Respond with a single JSON object and nothing else, with keys in this order: "synthesis" (string), "per_card" (array of {"position_index": number, "text": string, "nuances": string[]}, one entry per drawn card, in position order), "combined" (string), "reflective_prompts" (string[]).',
  ].join('\n');
}

function correspondenceLines(c: Record<string, unknown>): string {
  const keys = [
    'element',
    'sub_element',
    'planet',
    'zodiac',
    'decan',
    'rulership',
    'sephira',
    'path',
    'hebrew_letter',
    'hebrew_letter_meaning',
    'esoteric_title',
    'numerology',
  ];
  return keys
    .filter((k) => c[k] !== undefined && c[k] !== null && c[k] !== '')
    .map((k) => `${k.replace(/_/g, ' ')}: ${String(c[k])}`)
    .join('; ');
}

export function userPrompt(input: InterpretReadingInput): string {
  const lines: string[] = [];
  if (input.is_open_reflection) {
    lines.push(
      'Framing: an open reflection — the person drew without a specific question and wants to see what the cards bring up.',
    );
  } else {
    lines.push(`Question (their exact words): “${input.question ?? ''}”`);
  }
  if (input.life_area) lines.push(`Life area they chose: ${input.life_area}`);
  lines.push('', `Deck: ${input.deck.name}. ${input.deck.tradition_notes}`);
  lines.push(
    '',
    `Spread: ${input.spread.name}${input.spread.description ? ` — ${input.spread.description}` : ''}`,
  );
  lines.push('', 'Cards, in position (reference material from the deck’s own text):');
  for (const c of input.cards) {
    const id = [
      c.title ? `title “${c.title}”` : null,
      c.arcana === 'major' ? `major arcana${c.numeral ? ` ${c.numeral}` : ''}` : null,
      c.rank_label ? `court: ${c.rank_label}` : null,
      c.suit_label ? `suit: ${c.suit_label}` : null,
      c.element ? `element: ${c.element}` : null,
      c.astrology ? `astrology: ${c.astrology}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const orient =
      c.orientation === 'reversed'
        ? c.reversed_without_text
          ? 'reversed (this deck carries no reversed text; read the upright meaning with the position in mind)'
          : 'reversed'
        : 'upright';
    lines.push(
      '',
      `Position ${c.position_index + 1} — ${c.position_name}: ${c.position_prompt}`,
      `Card: ${c.name} (${orient})${id ? ` — ${id}` : ''}`,
      `Keywords: ${c.keywords.join(', ')}`,
      `Reference meaning: ${c.meaning}`,
    );
    const corr = correspondenceLines(c.correspondences);
    if (corr) lines.push(`Correspondences: ${corr}`);
  }
  if (input.user_notes) {
    lines.push(
      '',
      `What they noticed themselves (their exact words, which lead): “${input.user_notes}”`,
    );
  } else {
    lines.push('', 'They have not written their own note yet.');
  }
  if (input.forbidden_terms_sample.length) {
    lines.push(
      '',
      `Do not use these terms from the other deck system: ${input.forbidden_terms_sample.join(', ')}.`,
    );
  }
  return lines.join('\n');
}
