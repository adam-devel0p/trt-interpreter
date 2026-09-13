import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { jobs } from '@/db/schema';
import { logger } from '@/observability/logger';
import { JOB_HANDLERS } from './handlers';

export interface EnqueueOptions {
  userId?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
  /**
   * Skip the insert when a queued job of the same kind and payload already exists (notes
   * autosave enqueues an extraction on every pause; one is enough). Returns that job's id.
   */
  dedupe?: boolean;
}

/**
 * Persist a job. Payloads must be validated by the handler's schema up front so a bad enqueue
 * fails at the call site, not in the worker. Payloads carry IDs, never journal content.
 */
export async function enqueue(
  kind: string,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<{ id: string }> {
  const handler = JOB_HANDLERS.get(kind);
  if (!handler) throw new Error(`Unknown job kind: ${kind}`);
  const parsed = handler.schema.parse(payload);
  if (opts.dedupe) {
    const [existing] = await platformDb()
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, kind),
          eq(jobs.status, 'queued'),
          sql`${jobs.payload} = ${JSON.stringify(parsed)}::jsonb`,
        ),
      )
      .limit(1);
    if (existing) return existing;
  }
  const [row] = await platformDb()
    .insert(jobs)
    .values({
      kind,
      payload: parsed as Record<string, unknown>,
      userId: opts.userId ?? null,
      // Default to the database's own now(): a host clock a few ms ahead of the DB would
      // otherwise leave a fresh job "due in the future" for the very next claim.
      ...(opts.runAfter ? { runAfter: opts.runAfter } : {}),
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .returning({ id: jobs.id });
  if (!row) throw new Error('enqueue returned no row');
  logger.info('jobs.enqueued', { jobId: row.id, jobKind: kind, userId: opts.userId ?? undefined });
  return row;
}
