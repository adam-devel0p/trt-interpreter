/**
 * propose_journey task (docs/AI_LAYER.md#task-catalogue). Builds the request; the runner
 * validates against the versioned schema. Naming only: assignment is decided in
 * `src/domain/journeys`, and a user rename pins the title against this proposal.
 */
import type { ObjectRequest } from '../../types';
import { SYSTEM, userPrompt, type ProposeJourneyInput } from './prompt';
import { journeyProposalSchema, type JourneyProposal } from './schema';
import { PROMPT_VERSION, SCHEMA_VERSION } from './version';

export { PROMPT_VERSION, SCHEMA_VERSION };
export type { ProposeJourneyInput } from './prompt';
export { journeyProposalSchema, type JourneyProposal } from './schema';

export function buildProposeJourneyRequest(
  input: ProposeJourneyInput,
  opts: { userId: string; journeyId: string; themeSlugs?: string[] },
): ObjectRequest<JourneyProposal> {
  return {
    task: 'propose_journey',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(input) }],
    schema: journeyProposalSchema,
    maxTokens: 200,
    userId: opts.userId,
    objectRefs: [{ type: 'journey', id: opts.journeyId }],
    mockInput: {
      sharedEntities: input.shared_entities,
      themeSlugs: opts.themeSlugs ?? [],
      themeLabels: input.shared_themes.length
        ? input.shared_themes
        : [...new Set(input.entries.flatMap((e) => e.themes))],
      entries: input.entries.length,
    },
  };
}
