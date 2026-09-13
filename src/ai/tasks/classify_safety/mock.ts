/**
 * Keyword classifier for the mock provider: enough to exercise the §10 path end to end
 * without a model. Not a safety system — the real task is the model; this is test scaffolding.
 */
import type { FixtureRequest } from '../../providers/mock';

const RULES: { category: string; severity: string; re: RegExp }[] = [
  {
    category: 'self_harm',
    severity: 'high',
    re: /\b(kill myself|end my life|end it all|want to end it|suicid|self[- ]harm|hurt myself|not want to be (alive|here)|want to die)\b/i,
  },
  {
    category: 'immediate_safety',
    severity: 'high',
    re: /\b(hit me|hits me|threaten(s|ed|ing) (to|me)|being followed|unsafe at home|abus(es|ing) me|leave tonight)\b/i,
  },
  {
    category: 'medical',
    severity: 'medium',
    re: /\b(diagnos\w*|biopsy|chemo|surgery|medication|antidepressants?|stop taking|symptoms?)\b/i,
  },
  {
    category: 'legal',
    severity: 'medium',
    re: /\b(lawsuit|custody|charged with|court date|deportation|sue|lawyer)\b/i,
  },
  {
    category: 'financial',
    severity: 'medium',
    re: /\b(invest\w*|crypto|bet (on|the)|gambl\w*|savings|my debt)\b/i,
  },
];

export function mockSafety(req: FixtureRequest): unknown {
  const q = String(req.mockInput?.question ?? req.messages.at(-1)?.content ?? '');
  for (const r of RULES) if (r.re.test(q)) return { category: r.category, severity: r.severity };
  return { category: 'none', severity: 'low' };
}
