import { and, eq, isNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { readings } from '@/db/schema';
import { SCHEMA_VERSION } from '@/ai/tasks/extract_reading_metadata/version';
import { runExtraction } from '@/memory/extract';
import { defineJob } from '../types';
import { reprocessExtractionsPayload } from './payloads';

/**
 * `reprocess_extractions --object-type=reading --to-schema=N` (spec §7.2, docs/AI_LAYER.md
 * versioning): walks readings whose current extraction is not at the target schema — or
 * have none — and runs a fresh extraction for each. Superseded rows are kept; the user's
 * overrides are layered back on by the materialiser. Bounded per run; a follow-up job is
 * enqueued while work remains. Reports counts, never content.
 */
export const reprocessExtractions = defineJob({
  kind: 'reprocess_extractions',
  schema: reprocessExtractionsPayload,
  async run(payload, ctx) {
    // The deployed code writes SCHEMA_VERSION; any other target could never converge and the
    // job would re-enqueue itself forever.
    if (payload.toSchema !== SCHEMA_VERSION) {
      ctx.log.warn('jobs.reprocess_extractions.schema_mismatch', {
        status: `${payload.toSchema} vs ${SCHEMA_VERSION}`,
      });
      return;
    }
    const db = platformDb();
    const rows = await db
      .select({ id: readings.id })
      .from(readings)
      .where(
        and(
          isNull(readings.deletedAt),
          payload.userId ? eq(readings.userId, payload.userId) : undefined,
          sql`not exists (
            select 1 from public.extractions x
            where x.object_type = 'reading' and x.object_id = ${readings.id}
              and x.status = 'complete' and x.superseded_by is null
              and x.schema_version = ${payload.toSchema}
          )`,
          // Only readings whose owner consented — the run skips the rest anyway, but do not
          // burn a batch slot on them.
          sql`exists (select 1 from public.profiles p where p.id = ${readings.userId} and p.ai_consent_at is not null)`,
        ),
      )
      .orderBy(readings.occurredAt)
      .limit(payload.limit + 1);
    const batch = rows.slice(0, payload.limit);
    const counts = { complete: 0, failed: 0, skipped: 0 };
    for (const r of batch) {
      const outcome = await runExtraction(r.id, { force: true });
      counts[outcome.status] += 1;
    }
    ctx.log.info('jobs.reprocess_extractions.ran', {
      count: batch.length,
      status: `${counts.complete}/${counts.failed}/${counts.skipped}`,
    });
    if (rows.length > payload.limit) {
      const { enqueue } = await import('../enqueue');
      await enqueue('reprocess_extractions', payload, { userId: payload.userId });
    }
  },
});
