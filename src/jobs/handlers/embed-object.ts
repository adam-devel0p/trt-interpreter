import { embedObject } from '@/retrieval/backfill';
import { defineJob } from '../types';
import { embedObjectPayload } from './payloads';

/**
 * Rebuild one object's retrieval document and embed it (spec §8.3). Deduped on enqueue; a
 * provider failure retries the job (the document is already stored, only the vector is
 * missing). Consent is checked inside: no consent, no call, and the job is still a success.
 */
export const embedObjectJob = defineJob({
  kind: 'embed_object',
  schema: embedObjectPayload,
  async run(payload, ctx) {
    const out = await embedObject(payload.objectType, payload.objectId);
    ctx.log.info('jobs.embed_object.ran', {
      objectType: payload.objectType,
      objectId: payload.objectId,
      status: `${out.document}/${out.embedding}`,
      errorClass: out.errorClass,
    });
    if (out.embedding === 'failed') throw new Error(`embedding failed: ${out.errorClass}`);
  },
});
