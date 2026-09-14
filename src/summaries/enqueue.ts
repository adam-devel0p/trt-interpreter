import 'server-only';
import { enqueue } from '@/jobs/enqueue';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Queue hooks for the generated artefacts of Phase 10. Deduped on the queued job and
 * delayed so a burst of changes (an extraction, an assignment, an outcome) costs one run.
 * Never throw: a missed regeneration is caught by the next change or the sweep, and the
 * stored row stays honest in the meantime (the runner checks the fingerprint itself).
 */
export const NARRATIVE_DELAY_MS = 120_000;

export async function enqueueNarrativeSafely(
  journeyId: string,
  userId: string,
  opts: { delayMs?: number } = {},
): Promise<void> {
  try {
    await enqueue(
      'journey_narrative',
      { journeyId, force: false },
      {
        userId,
        dedupe: true,
        runAfter: new Date(Date.now() + (opts.delayMs ?? NARRATIVE_DELAY_MS)),
      },
    );
  } catch (err) {
    logger.warn('summaries.enqueue_failed', { userId, journeyId, errorClass: errorClassOf(err) });
  }
}
