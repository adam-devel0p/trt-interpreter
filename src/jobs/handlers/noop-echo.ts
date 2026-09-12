import { z } from 'zod';
import { defineJob } from '../types';

/**
 * Trivial handler used to prove the worker: success, retry and dead-letter paths.
 * `failUntilAttempt: n` throws on every attempt below n, so a job with n=2 fails once then
 * succeeds; n > max_attempts goes dead. The echo value is never logged — only its length.
 */
export const noopEchoPayload = z.object({
  echo: z.string().default(''),
  failUntilAttempt: z.number().int().min(1).default(1),
});

export class NoopEchoInducedFailure extends Error {
  override readonly name = 'NoopEchoInducedFailure';
}

export const noopEcho = defineJob({
  kind: 'noop_echo',
  schema: noopEchoPayload,
  async run(payload, ctx) {
    if (ctx.attempt < payload.failUntilAttempt) {
      throw new NoopEchoInducedFailure(`induced failure on attempt ${ctx.attempt}`);
    }
    ctx.log.info('jobs.noop_echo.ran', { jobId: ctx.jobId, count: payload.echo.length });
  },
});
