/**
 * The mock provider's default fixture for interpret_reading: a plausible layered object built
 * from the request's `mockInput` hints, so any reading can be interpreted without a model
 * (e2e, demo, integration tests). Deck-pure by construction (it only echoes the names it is
 * given) and hedged.
 */
import type { FixtureRequest } from '../../providers/mock';

interface Hints {
  deckSystem?: string;
  cards?: { position_index: number; position_name: string; name: string; keyword: string }[];
  question?: string | null;
  hasNote?: boolean;
}

export function mockInterpretation(req: FixtureRequest): unknown {
  const h = (req.mockInput ?? {}) as Hints;
  const cards = h.cards ?? [
    { position_index: 0, position_name: 'Card', name: 'The card', keyword: 'change' },
  ];
  const q = h.question ? `“${h.question}”` : 'what you are sitting with';
  const first = cards[0]!;
  return {
    synthesis: `Taken together, these cards suggest that ${q} may be less about a decision than about what ${first.name} in the ${first.position_name} position is asking you to notice.`,
    per_card: cards.map((c) => ({
      position_index: c.position_index,
      text: `In the ${c.position_name} position, ${c.name} may point to ${c.keyword || 'a shift'} as one thread running through ${q}. One way to read this is as a question rather than an answer: what would ${c.keyword || 'this'} look like here, in practice?`,
      nuances: [
        `Read another way, ${c.name} here might describe how the situation feels from the inside rather than what it is.`,
      ],
    })),
    combined: `Read as a whole, the ${cards.map((c) => c.name).join(', ')} seem to describe a movement from ${first.keyword || 'one state'} toward something you have not named yet. ${h.hasNote ? 'Your own note already touches this, and the cards mostly add texture to what you noticed.' : 'The cards do not settle the question; they suggest where it might be worth looking.'} It may help to hold the reading loosely and return to it once something has moved.`,
    reflective_prompts: [
      `What would change if you treated ${first.name} as describing you rather than the situation?`,
      'Which of these cards felt truest the moment you saw it, before you read anything?',
    ],
  };
}
