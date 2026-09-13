/**
 * extract_reading_metadata task (docs/AI_LAYER.md#task-catalogue). Builds the request; the
 * runner validates the payload against the versioned schema. Entity *resolution* is not the
 * model's job — `propose_entity_candidates` from the catalogue is folded into this call as
 * the `entities[]` proposals, and `domain/entities/resolve.ts` decides.
 */
import type { ObjectRef, ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type ExtractReadingInput } from './prompt';
import { extractionPayloadSchema, type ExtractionPayload } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { ExtractReadingInput } from './prompt';

export function buildExtractRequest(
  input: ExtractReadingInput,
  opts: { userId: string; readingId: string; objectRefs?: ObjectRef[] },
): ObjectRequest<ExtractionPayload> {
  return {
    task: 'extract_reading_metadata',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: extractionPayloadSchema,
    maxTokens: 1400,
    userId: opts.userId,
    objectRefs: opts.objectRefs ?? [{ type: 'reading', id: opts.readingId }],
    // Structural hints for the mock: the text it reads is the same text the prompt carries.
    mockInput: {
      question: input.question,
      notes: input.user_notes,
      lifeArea: input.life_area,
      cardNames: input.cards.map((c) => c.card_name),
    },
  };
}
