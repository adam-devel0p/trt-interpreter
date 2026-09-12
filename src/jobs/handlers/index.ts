import type { JobHandler } from '../types';
import { noopEcho } from './noop-echo';

/**
 * Handler registry. Later phases add: interpret, extract, embed, correlate, summarize, purge,
 * export. A job whose kind is not registered is marked dead immediately (nothing to retry).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: JobHandler<any>[] = [noopEcho];

export const JOB_HANDLERS: ReadonlyMap<string, JobHandler> = new Map(
  handlers.map((h) => [h.kind, h as JobHandler]),
);

export type JobKind = (typeof handlers)[number]['kind'];
