/**
 * extract_event_metadata task (docs/AI_LAYER.md#task-catalogue). Builds the request; the
 * runner validates the payload against the versioned schema. Same family as
 * `extract_reading_metadata`: the payload is materialised by the same code into the same
 * tables, keyed by `object_type = 'life_event'`.
 */
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type ExtractEventInput } from './prompt';
import { eventExtractionPayloadSchema, type EventExtractionPayload } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { ExtractEventInput } from './prompt';
export { eventExtractionPayloadSchema, type EventExtractionPayload } from './schema';

export function buildExtractEventRequest(
  input: ExtractEventInput,
  opts: { userId: string; eventId: string },
): ObjectRequest<EventExtractionPayload> {
  return {
    task: 'extract_event_metadata',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: eventExtractionPayloadSchema,
    maxTokens: 1200,
    userId: opts.userId,
    objectRefs: [{ type: 'life_event', id: opts.eventId }],
    // Structural hints for the mock: the same text the prompt carries.
    mockInput: { description: input.description, note: input.note },
  };
}
