/**
 * parse_history_query task (docs/AI_LAYER.md#task-catalogue): step 1 of hybrid retrieval.
 * Fast tier, tiny prompt, structured output. A failure here is not the end of an ask — the
 * pipeline falls back to an empty parse (similarity + recency only) and says so in the log.
 */
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type ParseHistoryQueryInput } from './prompt';
import { historyQuerySchema, type HistoryQuery } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { ParseHistoryQueryInput } from './prompt';
export { historyQuerySchema, type HistoryQuery } from './schema';

export function buildParseHistoryQueryRequest(
  input: ParseHistoryQueryInput,
  opts: { userId: string; askId: string },
): ObjectRequest<HistoryQuery> {
  return {
    task: 'parse_history_query',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: historyQuerySchema,
    modelHint: 'fast',
    maxTokens: 400,
    userId: opts.userId,
    objectRefs: [{ type: 'ask', id: opts.askId }],
    mockInput: { question: input.question, today: input.today },
  };
}
