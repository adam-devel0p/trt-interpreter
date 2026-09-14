/**
 * journey_narrative prompt (spec §6.5 narrative header). One concise sentence about how the
 * person's readings on one subject moved — "Your readings shifted from hesitation to action
 * over the last 3 months" — plus the progression labels it rests on, grounded only in the
 * journey's evidence package. The pipeline verifies the citations; an uncited sentence is
 * not stored and the deterministic header stays.
 */
export interface JourneyNarrativeInput {
  title: string;
  today: string;
  /** The deterministic theme progression, oldest first (labels). */
  progression: string[];
  counts: { readings: number; events: number; confirmedOutcomes: number };
  /** The rendered evidence package (`domain/retrieval/evidence.ts`). */
  evidence: string;
  droppedCount: number;
}

export const SYSTEM = [
  'You write the one-sentence header of a "journey" in someone\'s private tarot journal — an ongoing real-life subject several of their readings are about. Below is the journey\'s evidence: its readings, the life events and outcomes they recorded, connections they confirmed. Each piece has a label like [E3].',
  '',
  'Return one JSON object:',
  '{"sentence": "...", "progression": ["hesitation", "decision", "action"], "citations": ["E1", "E4"]}',
  '',
  'Rules:',
  '- One sentence, at most 30 words, second person, plain: how the readings on this subject moved over time, or what they kept returning to if they did not move. Example shape: "Your readings shifted from hesitation to action over the last three months."',
  '- "progression": two to four short lower-case labels in order, taken from the themes in the evidence (the derived progression is given as a starting point; keep it unless the entries say otherwise). Empty if there is no movement to name.',
  '- "citations": the labels the sentence rests on — the entries at the start and the end of the movement, or the ones that recur. At least one.',
  '- Use only the evidence given. Never name a card, date, person or event not in it.',
  '- Hedge about meaning ("seems to", "may have", "one way to read it"); state records plainly. No percentages, no "will", no "definitely", nothing supernatural, no advice, no verdict about the person.',
  '- Cards are evidence only that they were drawn. Say what the readings asked and what happened, not what the cards foretold.',
].join('\n');

export function userPrompt(input: JourneyNarrativeInput): string {
  const c = input.counts;
  return [
    `Today is ${input.today}.`,
    `Journey: “${input.title}” — ${c.readings} readings, ${c.events} life events, ${c.confirmedOutcomes} confirmed outcomes.`,
    input.progression.length
      ? `Derived theme progression, oldest first: ${input.progression.join(' → ')}.`
      : 'No theme progression could be derived yet.',
    input.droppedCount > 0
      ? `Note: ${input.droppedCount} further entries of the journey were left out of this package.`
      : 'This is every entry of the journey.',
    '',
    'Evidence:',
    input.evidence,
  ].join('\n');
}
