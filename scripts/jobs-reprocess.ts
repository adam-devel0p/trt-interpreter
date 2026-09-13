import './_env';
import { parseArgs } from 'node:util';

/**
 * `reprocess_extractions --object-type=reading --to-schema=extraction/1.0.0 [--user=<uuid>]`
 * (docs/AI_LAYER.md versioning). Enqueues the job and runs one batch straight away; the cron
 * batch continues while readings remain. Reports counts only.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      'object-type': { type: 'string', default: 'reading' },
      'to-schema': { type: 'string' },
      user: { type: 'string' },
      limit: { type: 'string', default: '50' },
    },
  });
  if (values['object-type'] !== 'reading') throw new Error('only --object-type=reading exists yet');
  const { SCHEMA_VERSION } = await import('@/ai/tasks/extract_reading_metadata/version');
  const toSchema = values['to-schema'] ?? SCHEMA_VERSION;
  const { enqueue } = await import('@/jobs/enqueue');
  const { runBatch } = await import('@/jobs/worker');
  const { closeAdmin } = await import('@/db/admin');
  const job = await enqueue(
    'reprocess_extractions',
    { objectType: 'reading', toSchema, userId: values.user ?? null, limit: Number(values.limit) },
    { userId: values.user ?? null },
  );
  const result = await runBatch({ jobId: job.id });
  console.log(JSON.stringify({ event: 'jobs.reprocess', toSchema, jobId: job.id, ...result }));
  await closeAdmin();
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
