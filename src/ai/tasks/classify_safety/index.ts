import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt } from './prompt';
import { safetyClassificationSchema, type SafetyClassification } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };

export function buildSafetyRequest(
  question: string,
  opts: { userId: string; readingId: string },
): ObjectRequest<SafetyClassification> {
  return {
    task: 'classify_safety',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(question) }],
    schema: safetyClassificationSchema,
    maxTokens: 64,
    userId: opts.userId,
    objectRefs: [{ type: 'reading', id: opts.readingId }],
    mockInput: { question },
  };
}
