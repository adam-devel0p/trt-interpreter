/**
 * Map a stored reading (query-layer view) to the task input: deck-native reference rows per
 * card for the drawn orientation, position prompts, the user's words verbatim.
 */
import type { ProfileRow } from '@/db/queries/profile';
import type { ReadingView } from '@/db/queries/readings';
import { selectDepth, type DepthPlan } from '@/domain/interpretation/depth';
import { LIFE_AREAS } from '@/domain/readings/types';
import type { SafetyClassification } from '@/domain/safety/categories';
import type { InterpretReadingInput } from '@/ai/tasks/interpret_reading';
import { forbiddenTermsSample } from './vocabulary';

export function depthFor(
  profile: Pick<ProfileRow, 'ai_explanation_depth' | 'experience_level'>,
): DepthPlan {
  return selectDepth({
    ai_explanation_depth: profile.ai_explanation_depth,
    experience_level: profile.experience_level,
  });
}

export function toInterpretInput(
  reading: ReadingView,
  depth: DepthPlan,
  safety: SafetyClassification,
): InterpretReadingInput {
  return {
    question: reading.question,
    is_open_reflection: reading.is_open_reflection,
    life_area: LIFE_AREAS.find((a) => a.key === reading.life_area)?.label ?? null,
    deck: {
      name: reading.deck.name,
      system: reading.deck.system,
      tradition_notes: reading.deck.tradition_notes,
      supports_reversals: reading.deck.supports_reversals,
    },
    spread: { name: reading.spread.name, description: reading.spread.description },
    cards: reading.cards.map((c) => {
      const reversed = c.orientation === 'reversed';
      const hasReversedText = reversed && !!c.card.meaning_reversed;
      return {
        position_index: c.position_index,
        position_name: c.position?.name ?? c.position_key,
        position_prompt: c.position?.prompt ?? 'What this card suggests in this position.',
        card_id: c.card.id,
        name: c.card.name,
        title: c.card.title,
        arcana: c.card.arcana,
        suit_label: c.card.suit_label,
        rank_label: c.card.rank_label,
        numeral: c.card.numeral,
        number: c.card.number,
        element: c.card.element,
        astrology: c.card.astrology,
        correspondences: c.card.correspondences as Record<string, unknown>,
        orientation: c.orientation,
        keywords:
          hasReversedText && c.card.keywords_reversed.length
            ? c.card.keywords_reversed
            : c.card.keywords_upright,
        meaning: hasReversedText ? c.card.meaning_reversed! : c.card.meaning_upright,
        reversed_without_text: reversed && !hasReversedText,
      };
    }),
    user_notes: reading.user_notes,
    depth,
    safety,
    forbidden_terms_sample: forbiddenTermsSample(reading.deck.system),
  };
}
