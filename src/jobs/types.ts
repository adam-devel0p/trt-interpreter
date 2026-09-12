import type { z } from 'zod';
import type { Logger } from '@/observability/logger';

export interface JobContext {
  jobId: string;
  /** 1-based attempt number for this execution. */
  attempt: number;
  maxAttempts: number;
  userId: string | null;
  log: Logger;
}

/** A handler owns its payload schema; the worker validates before calling `run`. */
export interface JobHandler<P = unknown> {
  kind: string;
  schema: z.ZodType<P>;
  run(payload: P, ctx: JobContext): Promise<void>;
}

export function defineJob<P>(handler: JobHandler<P>): JobHandler<P> {
  return handler;
}
