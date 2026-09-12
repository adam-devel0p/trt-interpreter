import './_env';

// Local stand-in for the Vercel cron: processes one bounded batch and exits.
async function main() {
  const { runBatch } = await import('@/jobs/worker');
  const { closeAdmin } = await import('@/db/admin');
  const result = await runBatch();
  console.log(JSON.stringify({ event: 'jobs.batch', ...result }));
  await closeAdmin();
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
