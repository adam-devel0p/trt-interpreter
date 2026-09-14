/**
 * explain_correlation task (docs/AI_LAYER.md#task-catalogue). Builds the request and checks
 * the sentence for what the prompt forbids — certainty words, figures, a card reading — so a
 * bad explanation fails soft and the deterministic reasons stay on screen. The model may
 * not invent or upgrade a link: the caller writes only the `explanation` column.
 */
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type ExplainCorrelationInput } from './prompt';
import { correlationExplanationSchema, type CorrelationExplanation } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { ExplainCorrelationInput } from './prompt';
export { correlationExplanationSchema, type CorrelationExplanation } from './schema';

/** Words that turn a hedged reason into a claim. */
export const FORBIDDEN_CLAIMS = [
  'predicted',
  'foresaw',
  'foretold',
  'confirmed',
  'definitely',
  'certainly',
  'proves',
  'proof',
  'will happen',
  'the cards',
  'card',
] as const;

export function explanationIssues(text: string): string[] {
  const issues: string[] = [];
  if (/\d/.test(text)) issues.push('contains a number');
  if (/%/.test(text)) issues.push('contains a percentage');
  for (const w of FORBIDDEN_CLAIMS)
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
      issues.push(`claims: ${w}`);
  const sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
  if (sentences > 2) issues.push('more than two sentences');
  if (text.trim().split(/\s+/).length > 48) issues.push('too long');
  return issues;
}

export function buildExplainCorrelationRequest(
  input: ExplainCorrelationInput,
  opts: { userId: string; linkId: string },
): ObjectRequest<CorrelationExplanation> {
  return {
    task: 'explain_correlation',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: correlationExplanationSchema,
    modelHint: 'fast',
    maxTokens: 160,
    userId: opts.userId,
    objectRefs: [{ type: 'link', id: opts.linkId }],
    mockInput: { reasons: input.reasons, band: input.band },
  };
}
