/**
 * Mock explainer: joins the computed reasons into one hedged sentence. It adds nothing,
 * which is exactly what the real prompt is told to do.
 */
import type { FixtureRequest } from '../../providers/mock';
import type { CorrelationExplanation } from './schema';

export function mockExplanation(req: FixtureRequest): CorrelationExplanation {
  const reasons = ((req.mockInput?.reasons as string[] | undefined) ?? []).map((r) =>
    r.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, ''),
  );
  const band = req.mockInput?.band === 'likely' ? 'looks likely to be' : 'may be';
  const head = reasons.slice(0, -1);
  const tail = reasons[reasons.length - 1];
  const body =
    head.length === 0
      ? (tail ?? 'they happened close together')
      : `${head.join(', ')}, and they happened ${tail?.toLowerCase() ?? 'close together'}`;
  return { explanation: `This event ${band} connected to the reading: ${body}.` };
}
