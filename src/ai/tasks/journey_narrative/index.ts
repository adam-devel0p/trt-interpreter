/**
 * journey_narrative task (docs/AI_LAYER.md#task-catalogue, spec §6.5). Standard tier. The
 * request carries the journey's bounded evidence package; the caller verifies the citations
 * (`domain/summaries/provenance.ts`) and asks for one repair before keeping the
 * deterministic header. Regenerated only on a material change (`domain/journeys/narrativeChange.ts`).
 */
import type { MockEvidenceObject } from '../answer_from_evidence';
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type JourneyNarrativeInput } from './prompt';
import { journeyNarrativeSchema, type JourneyNarrative } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { JourneyNarrativeInput } from './prompt';
export { journeyNarrativeSchema, type JourneyNarrative } from './schema';

export function buildJourneyNarrativeRequest(
  input: JourneyNarrativeInput,
  opts: { userId: string; journeyId: string; mockObjects: MockEvidenceObject[] },
): ObjectRequest<JourneyNarrative> {
  return {
    task: 'journey_narrative',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: journeyNarrativeSchema,
    maxTokens: 300,
    userId: opts.userId,
    objectRefs: [{ type: 'journey', id: opts.journeyId }],
    mockInput: { title: input.title, progression: input.progression, objects: opts.mockObjects },
  };
}

export function repairHint(issues: string[], stripped: string[]): string {
  const parts = ['Your previous sentence could not be verified.'];
  if (stripped.length)
    parts.push(
      `These labels are not in the evidence and must not be cited: ${stripped.join(', ')}.`,
    );
  if (issues.includes('uncited sentence'))
    parts.push('Cite at least one label from the evidence the sentence rests on.');
  if (issues.some((i) => i.startsWith('register')))
    parts.push('Remove certainty language and percentages; hedge about meaning.');
  return parts.join(' ');
}
