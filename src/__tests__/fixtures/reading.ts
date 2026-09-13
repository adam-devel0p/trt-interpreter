import type { ReadingView } from '@/db/queries/readings';
import type { CompleteInterpretation } from '@/db/queries/interpretations';
import { SPREADS } from '@/db/seed/decks/spreads';
import type { CardSeed, DeckSeed } from '@/domain/decks/types';

/** A `ReadingView` built from the pure seed modules — no database, deck-native rows. */

export const view = (deck: DeckSeed, c: CardSeed, deckId: string) => ({
  id: `${deck.system}-${c.slug}`,
  deck_id: deckId,
  deck_system: deck.system,
  deck_name: deck.name,
  slug: c.slug,
  name: c.name,
  title: c.title,
  arcana: c.arcana,
  suit: c.suit,
  suit_label: c.suit_label,
  rank_label: c.rank_label,
  number: c.number,
  numeral: c.numeral,
  element: c.element,
  astrology: c.astrology,
  correspondences: c.correspondences,
  art_asset_path: c.art_asset_path,
  sort_order: c.sort_order,
  keywords_upright: c.keywords_upright,
  keywords_reversed: c.keywords_reversed,
  meaning_upright: c.meaning_upright,
  meaning_reversed: c.meaning_reversed,
});

export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000002';

export function fixtureReading(
  deck: DeckSeed,
  slugs: string[],
  over: Partial<ReadingView> = {},
): ReadingView {
  const deckId = `00000000-0000-4000-8000-00000000000${deck.system === 'rws' ? 'a' : 'b'}`;
  const spread = SPREADS.find((s) => s.positions.length === slugs.length)!;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: FIXTURE_USER_ID,
    created_at: '2026-09-12T10:00:00.000Z',
    occurred_at: '2026-09-12T10:00:00.000Z',
    question: 'Should I take the job?',
    is_open_reflection: false,
    life_area: 'work',
    spread_id: '00000000-0000-4000-8000-000000000003',
    deck_id: deckId,
    source: 'physical',
    uses_reversals: deck.supports_reversals,
    user_notes: 'My own words.',
    follow_up_status: 'unresolved',
    revisit_at: null,
    rng: null,
    metadata_version: 1,
    updated_at: '2026-09-12T10:00:00.000Z',
    deck: {
      id: deckId,
      slug: deck.slug,
      name: deck.name,
      system: deck.system,
      tradition_notes: deck.tradition_notes,
      supports_reversals: deck.supports_reversals,
      art_strategy: deck.art_strategy,
      license_note: deck.license_note,
      sort_order: deck.sort_order,
    },
    spread: {
      id: '00000000-0000-4000-8000-000000000003',
      user_id: null,
      slug: spread.slug,
      name: spread.name,
      description: spread.description,
      positions: spread.positions,
      layout: spread.layout,
      is_builtin: true,
      deck_scope: null,
      card_count: spread.positions.length,
      sort_order: 0,
    },
    cards: slugs.map((slug, i) => ({
      id: `rc-${i}`,
      position_index: i,
      position_key: spread.positions[i]!.key,
      orientation: i === 1 && deck.supports_reversals ? 'reversed' : 'upright',
      user_meaning: null,
      card: {
        ...view(
          deck,
          deck.cards.find((c) => c.slug === slug)!,
          deckId,
        ),
        id: `00000000-0000-4000-8000-0000000000${(10 + i).toString(16).padStart(2, '0')}`,
      },
      position: spread.positions[i]!,
    })),
    ...over,
  };
}

/** A stored, complete interpretation row for the reading above. */
export function fixtureInterpretation(reading: ReadingView): CompleteInterpretation {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    reading_id: reading.id,
    user_id: reading.user_id,
    status: 'complete',
    fact_status: 'TAROT_INTERPRETATION',
    metadata_version: reading.metadata_version,
    depth: 'standard',
    synthesis:
      'Taken together, these cards suggest the question may be about pace rather than direction.',
    per_card: reading.cards.map((c) => ({
      position_index: c.position_index,
      card_id: c.card.id,
      text: `${c.card.name} in the ${c.position?.name} position may point to one thread of the question.`,
      nuances: ['Read another way, it might describe how this feels rather than what it is.'],
    })),
    combined: 'Read as a whole, the cards suggest a movement you have not named yet.',
    reflective_prompts: [
      'What would change if you treated this as already decided?',
      'Which card felt truest?',
    ],
    model_id: 'mock-deep',
    prompt_version: 'interpret_reading/1.0.0',
    schema_version: 'interpretation/1.0.0',
    tokens_in: 100,
    tokens_out: 50,
    cost_micros: 0,
    latency_ms: 10,
    error_class: null,
    feedback: null,
    feedback_reason: null,
    feedback_at: null,
    superseded_by: null,
    generated_at: '2026-09-12T10:01:00.000Z',
    created_at: '2026-09-12T10:00:30.000Z',
    updated_at: '2026-09-12T10:01:00.000Z',
  };
}
