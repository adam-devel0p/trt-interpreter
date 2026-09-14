/**
 * explain_correlation prompt (spec §8.2, §3.3 explainable memory). The engine has already
 * scored a pair and listed its reasons; the model turns those reasons into one or two plain
 * sentences a person can read. It may not add evidence, judge the connection, or state that
 * the reading foresaw the event. Context is the minimum: the two entries' own words, the
 * band and the reasons — no history.
 */
export interface ExplainCorrelationInput {
  reading: { occurred_on: string; question: string | null };
  event: { occurred_on: string; description: string };
  band: 'possible' | 'likely';
  reasons: string[];
}

export const SYSTEM = [
  'A tarot journal has noticed that a reading and a later life event might be connected. Deterministic code scored the pair and listed the reasons. Your only job is to say those reasons in one or two plain sentences, as a careful friend would.',
  '',
  'Return one JSON object: {"explanation": "..."}.',
  '',
  'Rules:',
  '- Use only the reasons given. Add nothing. Do not mention cards, symbolism or what the reading "meant".',
  '- Hedge: "may", "might", "seems", "looks like". Never "predicted", "foresaw", "confirmed", "definitely", "will".',
  '- No numbers, percentages or scores.',
  '- Do not tell the person what to do.',
  '- One or two sentences, at most forty words.',
].join('\n');

export function userPrompt(input: ExplainCorrelationInput): string {
  return [
    `Reading (${input.reading.occurred_on}): ${input.reading.question ? `“${input.reading.question}”` : 'an open reflection'}`,
    `Event (${input.event.occurred_on}): “${input.event.description}”`,
    `Strength as computed: ${input.band === 'likely' ? 'a likely connection' : 'a possible connection'}`,
    'Reasons:',
    ...input.reasons.map((r) => `- ${r}`),
  ].join('\n');
}
