/**
 * summarize_period prompt (spec FR-20, §9.2, §19, §21.7). The model writes a short
 * retrospective of one period from a bounded, labelled evidence package — the same
 * rendering the Ask pipeline uses — and nothing else. Every claim cites labels and says what
 * kind of thing it is; the pipeline verifies both (`domain/summaries/provenance.ts`) and
 * drops what it cannot verify. A "confirmed fact" is only what the person recorded: an
 * event they logged, an outcome they marked, a connection they confirmed. Cards and themes
 * are observations about the readings, never facts about their life.
 */
export interface SummarizePeriodInput {
  /** "August 2026", "the week of 10 August 2026", "the journey “Me and Maya”". */
  periodLabel: string;
  kind: 'weekly' | 'monthly' | 'journey' | 'yearly';
  start: string;
  end: string;
  today: string;
  /** Counts for the headline's honesty. */
  counts: { readings: number; events: number; outcomes: number; confirmedLinks: number };
  /** Journeys with activity in the period (titles only). */
  journeys: string[];
  /** The rendered evidence package (`domain/retrieval/evidence.ts`). */
  evidence: string;
  /** How many objects in the period were left out of the package. */
  droppedCount: number;
}

export const SYSTEM = [
  "You write a short, honest retrospective of one period of someone's private tarot journal, from the evidence below and nothing else. Each piece of evidence has a label like [E3]: readings they did, life events they logged, outcomes they recorded, connections they confirmed.",
  '',
  'Return one JSON object:',
  '{"headline": "...", "recurred": [claim], "shifted": [claim], "open": [claim], "confirmed": [claim]}',
  'where a claim is {"text": "...", "basis": "confirmed_fact" | "tarot_interpretation" | "user_reflection" | "inferred", "citations": ["E3", "E7"]}.',
  '',
  'Sections:',
  '- "recurred": cards, suits, themes or questions that came back more than once. Name a pattern only from three or more entries; two appearances are "twice", not a pattern.',
  '- "shifted": what changed across the period — in the questions asked, the themes, or from asking to doing. Only if the evidence shows a change.',
  '- "open": readings still waiting on what happened (unresolved follow-up, a revisit date passed).',
  '- "confirmed": what the person recorded actually happened — outcomes marked, events logged, connections confirmed. Only these may carry basis "confirmed_fact".',
  'Any section may be empty. Prefer fewer, sharper claims: at most four per section.',
  '',
  'Rules — these matter more than being complete:',
  '- Use only the evidence given. Never mention a reading, card, date, person or event that is not in the package.',
  '- Every claim cites the labels it rests on; a claim with no citation is not allowed. Do not cite labels that are not in the package.',
  '- "basis" is the kind of thing the claim is: "confirmed_fact" only for what the person recorded (an outcome, a logged event, a confirmed connection) and only when a cited label carries that record; "tarot_interpretation" for what cards suggested; "user_reflection" for their own notes and feelings, attributed to them; "inferred" for a pattern you noticed across entries. Generated text never makes a fact.',
  '- Fields marked "(derived)" were produced by software; say "the journal noted", not "you said".',
  '- Cards are evidence only that they were drawn. Say a card appeared, not what it foretold.',
  '- Hedge about meaning ("suggests", "may point to", "one way to read this"); be plain about records. No percentages, no accuracy claims, no "will", no "definitely", nothing supernatural, no advice.',
  '- "headline": one plain sentence the person would recognise as their month — specific, not generic. If the period is thin, say what it holds rather than padding.',
  '- Second person, warm, specific. Refer to entries by date and question inside the text, never by label.',
].join('\n');

export function userPrompt(input: SummarizePeriodInput): string {
  const c = input.counts;
  return [
    `Today is ${input.today}.`,
    `Period: ${input.periodLabel} (${input.start} to ${input.end}, ${input.kind}).`,
    `It holds ${c.readings} readings, ${c.events} life events, ${c.outcomes} recorded outcomes and ${c.confirmedLinks} confirmed connections.`,
    input.journeys.length
      ? `Journeys active in it: ${input.journeys.join('; ')}.`
      : 'No journey was active in it.',
    input.droppedCount > 0
      ? `Note: ${input.droppedCount} further entries of the period were left out of this package; say "among the entries here", not "all".`
      : 'This is every entry of the period.',
    '',
    'Evidence:',
    input.evidence,
  ].join('\n');
}
