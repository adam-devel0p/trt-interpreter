/**
 * Rule-based narrator for the mock provider: the derived progression's first and last
 * labels make the sentence; the citations are the earliest and latest readings. Enough to
 * exercise the regeneration rule, the verifier and the header without a model.
 */
import type { FixtureRequest } from '../../providers/mock';
import type { MockEvidenceObject } from '../answer_from_evidence';
import type { JourneyNarrative } from './schema';

function spanWords(first: string, last: string): string {
  const days = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000);
  if (days < 21) return 'over a few weeks';
  const months = Math.max(1, Math.round(days / 30));
  return months === 1 ? 'over about a month' : `over about ${months} months`;
}

export function mockJourneyNarrative(req: FixtureRequest): JourneyNarrative {
  const objects = (req.mockInput?.objects as MockEvidenceObject[] | undefined) ?? [];
  const progression = ((req.mockInput?.progression as string[] | undefined) ?? []).map((p) =>
    p.toLowerCase(),
  );
  const title = String(req.mockInput?.title ?? 'this');
  const readings = [...objects.filter((o) => o.type === 'reading')].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  const first = readings[0] ?? objects[0];
  const last = readings[readings.length - 1] ?? objects[objects.length - 1];
  if (!first || !last)
    return {
      sentence: `Nothing has gathered around ${title} yet.`,
      progression: [],
      citations: [],
    };
  const span = spanWords(first.date, last.date);
  const outcomes = objects.filter((o) => o.outcomes.length > 0);
  const distinct = progression.filter((p, i) => i === 0 || p !== progression[i - 1]);
  // At most four labels, always keeping the first and the last so the sentence matches them.
  const steps =
    distinct.length <= 4
      ? distinct
      : [distinct[0]!, distinct[Math.floor(distinct.length / 2)]!, distinct[distinct.length - 1]!];
  const from = steps[0];
  const to = steps[steps.length - 1];
  if (steps.length >= 2 && from && to && from !== to) {
    return {
      sentence: `Your readings about ${title} seem to have moved from ${from} toward ${to} ${span}${outcomes.length ? ', with what happened recorded along the way' : ''}.`,
      progression: steps,
      citations: [
        ...new Set([first.label, last.label, ...outcomes.slice(0, 2).map((o) => o.label)]),
      ],
    };
  }
  const theme = first.themes[0] ?? last.themes[0];
  return {
    sentence: theme
      ? `Your readings about ${title} keep returning to ${theme.toLowerCase()} ${span}.`
      : `Your readings about ${title} have gathered ${span} without a single theme taking over.`,
    progression: steps.slice(0, 4),
    citations: [...new Set([first.label, last.label])],
  };
}
