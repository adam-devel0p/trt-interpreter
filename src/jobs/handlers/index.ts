import type { z } from 'zod';
import type { JobHandler } from '../types';
import { exportUserData } from './export-user-data';
import { noopEcho } from './noop-echo';
import {
  extractReadingPayload,
  proposeJourneyPayload,
  reprocessExtractionsPayload,
} from './payloads';
import { purgeDeleted } from './purge-deleted';

/**
 * Handler registry. Phase 05 added `purge_deleted` and `export_user_data`; Phase 06 adds
 * `extract_reading_metadata` and `reprocess_extractions`; Phase 07 `propose_journey`. The AI-backed handlers are loaded
 * lazily: their payload schemas live in `./payloads` so `enqueue()` can validate without the
 * model layer on the import graph, and the worker only loads the module when it claims a job
 * of that kind. A job whose kind is not registered is marked dead immediately.
 */
export interface HandlerEntry {
  kind: string;
  schema: z.ZodType;
  load(): Promise<JobHandler>;
}

const entries: HandlerEntry[] = [
  { kind: noopEcho.kind, schema: noopEcho.schema, load: async () => noopEcho as JobHandler },
  {
    kind: purgeDeleted.kind,
    schema: purgeDeleted.schema,
    load: async () => purgeDeleted as JobHandler,
  },
  {
    kind: exportUserData.kind,
    schema: exportUserData.schema,
    load: async () => exportUserData as JobHandler,
  },
  {
    kind: 'extract_reading_metadata',
    schema: extractReadingPayload,
    load: async () => (await import('./extract-reading')).extractReading as JobHandler,
  },
  {
    kind: 'propose_journey',
    schema: proposeJourneyPayload,
    load: async () => (await import('./propose-journey')).proposeJourney as JobHandler,
  },
  {
    kind: 'reprocess_extractions',
    schema: reprocessExtractionsPayload,
    load: async () => (await import('./reprocess-extractions')).reprocessExtractions as JobHandler,
  },
];

export const JOB_HANDLERS: ReadonlyMap<string, HandlerEntry> = new Map(
  entries.map((h) => [h.kind, h]),
);

export type JobKind = (typeof entries)[number]['kind'];
