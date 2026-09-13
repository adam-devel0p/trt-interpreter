/**
 * Rule-based namer for the mock provider: the shared entity, else the two strongest themes.
 * Enough to exercise the naming job, the title pin and the eval pipeline without a model.
 */
import type { FixtureRequest } from '../../providers/mock';
import type { JourneyProposal } from './schema';

export function mockJourneyProposal(req: FixtureRequest): JourneyProposal {
  const shared = (req.mockInput?.sharedEntities as string[] | undefined) ?? [];
  const labels = (req.mockInput?.themeLabels as string[] | undefined) ?? [];
  const entries = Number(req.mockInput?.entries ?? 0);
  const entity = shared[0];
  if (entity) {
    // The subject plus the strongest theme label, joined plainly — a claim-free title.
    const theme = labels[0] && labels[0].toLowerCase() !== entity.toLowerCase() ? labels[0] : null;
    const title = theme ? `${entity} and ${theme.toLowerCase()}` : entity;
    return {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      rationale: `Every one of the ${entries || 'grouped'} entries names ${entity}.`,
      confidence: 'high',
    };
  }
  const [a, b] = labels;
  if (a && b)
    return {
      title: `${a} and ${b.toLowerCase()}`,
      rationale: `The entries keep returning to ${a.toLowerCase()} and ${b.toLowerCase()}.`,
      confidence: 'medium',
    };
  if (a)
    return {
      title: a,
      rationale: `${a} runs through these entries.`,
      confidence: 'medium',
    };
  return {
    title: 'A thread without a name',
    rationale: 'Nothing explicit links these entries.',
    confidence: 'low',
  };
}
