import { parseArgs } from 'node:util';
import './_env';

/**
 * Phase 11 ops entry: queue one `deliver_reminders` sweep (everyone who chose a channel, or
 * `--user <id>`) and run it now. Local stand-in for the hourly cron. Deliveries are logged,
 * not sent, unless `NOTIFICATION_DELIVERY=live` with keys.
 */
async function main() {
  const { values } = parseArgs({ options: { user: { type: 'string' } } });
  const { enqueue } = await import('@/jobs/enqueue');
  const { runBatch } = await import('@/jobs/worker');
  const { closeAdmin } = await import('@/db/admin');
  const job = await enqueue('deliver_reminders', { userId: values.user ?? null });
  const result = await runBatch({ jobId: job.id });
  console.log(JSON.stringify({ event: 'jobs.batch', kind: 'deliver_reminders', ...result }));
  await closeAdmin();
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
