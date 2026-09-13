/**
 * detect_repeat_question (FR-25): embed the question, then a deterministic rule in domain/.
 * This module only builds the embedding request; the comparison and the verdict are pure
 * (`domain/interpretation/repeat.ts`) and the storage lives in the query layer.
 */
import type { EmbedRequest } from '../../types';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };

export function buildQuestionEmbedRequest(question: string, userId: string): EmbedRequest {
  return { task: 'detect_repeat_question', texts: [question], userId };
}
