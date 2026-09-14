import './_env';

/**
 * Phase 10 ops entry: queue the `schedule_summaries` sweep (recent complete periods and
 * open journeys of every consenting user on the flag) and run batches until the queue is
 * drained. A hosted cron would enqueue the sweep and let the usual batch pick it up; this
 * script is the local stand-in.
 */
async function main() {
  const { enqueue } = await import('@/jobs/enqueue');
  const { runBatch } = await import('@/jobs/worker');
  const { closeAdmin } = await import('@/db/admin');
  const job = await enqueue('schedule_summaries', { userId: null, months: 2, weeks: 2 });
  console.log(JSON.stringify({ event: 'jobs.enqueued', kind: 'schedule_summaries', id: job.id }));
  for (let i = 0; i < 50; i++) {
    const result = await runBatch({ limit: 25 });
    console.log(JSON.stringify({ event: 'jobs.batch', ...result }));
    if (result.claimed === 0) break;
  }
  await closeAdmin();
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
