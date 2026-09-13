/**
 * List prices per model, in micro-dollars per token, for `ai_calls.cost_micros` (§13 cost
 * telemetry). Prefix-matched so a dated snapshot ID resolves to its family. Unknown models cost
 * 0 and are flagged in the usage page, never guessed.
 */
export interface ModelPrice {
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
}

const PRICES: [prefix: string, price: ModelPrice][] = [
  ['claude-opus-5', { inputMicrosPerToken: 5, outputMicrosPerToken: 25 }],
  ['claude-opus-4', { inputMicrosPerToken: 5, outputMicrosPerToken: 25 }],
  ['claude-sonnet-5', { inputMicrosPerToken: 2, outputMicrosPerToken: 10 }],
  ['claude-sonnet-4', { inputMicrosPerToken: 3, outputMicrosPerToken: 15 }],
  ['claude-haiku-4-5', { inputMicrosPerToken: 1, outputMicrosPerToken: 5 }],
  ['text-embedding-3-small', { inputMicrosPerToken: 0.02, outputMicrosPerToken: 0 }],
  ['text-embedding-3-large', { inputMicrosPerToken: 0.13, outputMicrosPerToken: 0 }],
];

export function priceFor(modelId: string): ModelPrice | null {
  const hit = PRICES.find(([prefix]) => modelId.startsWith(prefix));
  return hit ? hit[1] : null;
}

export function costMicros(modelId: string, tokensIn: number, tokensOut: number): number {
  const p = priceFor(modelId);
  if (!p) return 0;
  return Math.round(tokensIn * p.inputMicrosPerToken + tokensOut * p.outputMicrosPerToken);
}
