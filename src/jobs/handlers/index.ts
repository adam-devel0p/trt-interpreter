import type { JobHandler } from '../types';
import { exportUserData } from './export-user-data';
import { noopEcho } from './noop-echo';
import { purgeDeleted } from './purge-deleted';

/**
 * Handler registry. Phase 05 added `purge_deleted` and `export_user_data`; later phases add
 * extract, embed, correlate, summarize. A job whose kind is not registered is marked dead
 * immediately (nothing to retry).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: JobHandler<any>[] = [noopEcho, purgeDeleted, exportUserData];

export const JOB_HANDLERS: ReadonlyMap<string, JobHandler> = new Map(
  handlers.map((h) => [h.kind, h as JobHandler]),
);

export type JobKind = (typeof handlers)[number]['kind'];
