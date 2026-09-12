import 'server-only';
import { sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { jobs, type Job } from '@/db/schema';
import { errorClassOf, logger } from '@/observability/logger';
import { JOB_HANDLERS } from './handlers';

export interface BatchResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

export const WORKER_POLICY = {
  defaultBatch: 25,
  /** A `running` job whose lock is older than this is assumed crashed and is reclaimed. */
  staleLockMs: 10 * 60_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 60 * 60_000,
} as const;

/** Exponential backoff on attempt number, with ±25% jitter. Exported for tests. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(WORKER_POLICY.backoffBaseMs * 2 ** attempt, WORKER_POLICY.backoffMaxMs);
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Claim up to `limit` runnable jobs atomically (FOR UPDATE SKIP LOCKED so concurrent workers
 * never double-run) and execute them sequentially. One bounded batch per call.
 */
export async function runBatch(opts: { limit?: number } = {}): Promise<BatchResult> {
  const limit = opts.limit ?? WORKER_POLICY.defaultBatch;
  const db = platformDb();
  // Raw SQL params must be strings/numbers: drizzle's execute() does not serialise Date.
  const stale = new Date(Date.now() - WORKER_POLICY.staleLockMs).toISOString();

  const claimed = await db.execute<Job>(sql`
    update ${jobs} set status = 'running', locked_at = now(), attempts = attempts + 1,
      updated_at = now()
    where id in (
      select id from ${jobs}
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < ${stale}::timestamptz)
      order by run_after asc
      limit ${limit}::int
      for update skip locked
    )
    returning id, user_id as "userId", kind, payload, status, attempts,
      max_attempts as "maxAttempts", run_after as "runAfter", locked_at as "lockedAt",
      last_error_class as "lastErrorClass", created_at as "createdAt", updated_at as "updatedAt"
  `);

  const result: BatchResult = { claimed: claimed.length, succeeded: 0, retried: 0, dead: 0 };

  for (const job of claimed) {
    const log = logger.child({
      jobId: job.id,
      jobKind: job.kind,
      attempt: job.attempts,
      userId: job.userId ?? undefined,
    });
    const handler = JOB_HANDLERS.get(job.kind);
    if (!handler) {
      await markDead(job.id, 'UnknownJobKind');
      result.dead += 1;
      log.error('jobs.unknown_kind');
      continue;
    }
    const started = Date.now();
    try {
      const payload = handler.schema.parse(job.payload);
      await handler.run(payload, {
        jobId: job.id,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        userId: job.userId,
        log,
      });
      await db.execute(sql`
        update ${jobs} set status = 'succeeded', locked_at = null, updated_at = now()
        where id = ${job.id}`);
      result.succeeded += 1;
      log.info('jobs.succeeded', { durationMs: Date.now() - started });
    } catch (err) {
      const errorClass = errorClassOf(err);
      if (job.attempts >= job.maxAttempts) {
        await markDead(job.id, errorClass);
        result.dead += 1;
        log.error('jobs.dead', { errorClass, attempts: job.attempts });
      } else {
        const delay = backoffMs(job.attempts);
        await db.execute(sql`
          update ${jobs} set status = 'queued', locked_at = null,
            run_after = now() + make_interval(secs => ${delay / 1000}::float8),
            last_error_class = ${errorClass}, updated_at = now()
          where id = ${job.id}`);
        result.retried += 1;
        log.warn('jobs.retry_scheduled', { errorClass, attempts: job.attempts, durationMs: delay });
      }
    }
  }
  return result;
}

async function markDead(id: string, errorClass: string): Promise<void> {
  await platformDb().execute(sql`
    update ${jobs} set status = 'dead', locked_at = null, last_error_class = ${errorClass},
      updated_at = now()
    where id = ${id}`);
}
