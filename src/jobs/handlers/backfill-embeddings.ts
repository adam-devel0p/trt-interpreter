import { backfillEmbeddings } from '@/retrieval/backfill';
import { enqueue } from '../enqueue';
import { defineJob } from '../types';
import { backfillEmbeddingsPayload } from './payloads';

/**
 * Build missing retrieval documents and embed stale vectors for one user (or every
 * consenting user), bounded per run; re-enqueues itself while work remains. Also the path
 * for an embedding-model change: every vector at the old model counts as stale.
 */
export const backfillEmbeddingsJob = defineJob({
  kind: 'backfill_embeddings',
  schema: backfillEmbeddingsPayload,
  async run(payload, ctx) {
    const out = await backfillEmbeddings({ userId: payload.userId, limit: payload.limit });
    ctx.log.info('jobs.backfill_embeddings.ran', {
      count: out.built + out.embedded,
      attempts: out.failed,
      status: out.more ? 'more' : 'done',
    });
    if (out.more && out.failed === 0)
      await enqueue('backfill_embeddings', payload, { dedupe: true });
  },
});
