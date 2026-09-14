import 'server-only';
import { enqueue } from '@/jobs/enqueue';
import { errorClassOf, logger } from '@/observability/logger';
import type { HistoryObjectType } from './objects';

/**
 * Queue a retrieval-document rebuild (+ embedding) for one object. Called from the write
 * paths that change what the document says; deduped on the queued job, so a burst of edits
 * costs one rebuild. The save paths pass a delay so the extraction that usually follows a
 * save lands first and the document is built once with its themes and entities. Never
 * throws: a missed rebuild is caught by the next write or by the backfill.
 */
export const EMBED_AFTER_SAVE_DELAY_MS = 90_000;

export async function enqueueEmbedSafely(
  objectType: HistoryObjectType,
  objectId: string,
  userId: string,
  opts: { delayMs?: number } = {},
): Promise<void> {
  try {
    await enqueue(
      'embed_object',
      { objectType, objectId },
      {
        userId,
        dedupe: true,
        ...(opts.delayMs ? { runAfter: new Date(Date.now() + opts.delayMs) } : {}),
      },
    );
  } catch (err) {
    logger.warn('retrieval.enqueue_failed', {
      userId,
      objectType,
      objectId,
      errorClass: errorClassOf(err),
    });
  }
}
