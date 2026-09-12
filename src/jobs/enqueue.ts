import 'server-only';
import { platformDb } from '@/db/admin';
import { jobs } from '@/db/schema';
import { logger } from '@/observability/logger';
import { JOB_HANDLERS } from './handlers';

export interface EnqueueOptions {
  userId?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
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
  const [row] = await platformDb()
    .insert(jobs)
    .values({
      kind,
      payload: parsed as Record<string, unknown>,
      userId: opts.userId ?? null,
      runAfter: opts.runAfter ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .returning({ id: jobs.id });
  if (!row) throw new Error('enqueue returned no row');
  logger.info('jobs.enqueued', { jobId: row.id, jobKind: kind, userId: opts.userId ?? undefined });
  return row;
}
