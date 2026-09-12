/**
 * Every closed-set enum from docs/DATA_MODEL.md#enums. All are created in migration
 * 0001_platform so later phases only add tables, never enums with retroactive values.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const deckSystem = pgEnum('deck_system', ['rws', 'thoth']);
export const readingSource = pgEnum('reading_source', ['digital', 'physical']);
export const orientation = pgEnum('orientation', ['upright', 'reversed']);
export const followUpStatus = pgEnum('follow_up_status', [
  'unresolved',
  'partly_resolved',
  'resolved',
  'not_relevant',
]);
/** The spine of §9.2. CONFIRMED_FACT and USER_REFLECTION are user-only (see AI_LAYER write gate). */
export const factStatus = pgEnum('fact_status', [
  'CONFIRMED_FACT',
  'INFERRED_EVENT',
  'USER_REFLECTION',
  'TAROT_INTERPRETATION',
  'POSSIBILITY',
  'SYSTEM_CORRELATION',
]);
export const createdBy = pgEnum('created_by', ['user', 'model', 'rule']);
export const linkState = pgEnum('link_state', ['pending', 'confirmed', 'maybe', 'rejected']);
export const outcomeStatus = pgEnum('outcome_status', [
  'happened',
  'partly',
  'did_not_happen',
  'unresolved',
  'irrelevant',
]);
export const entityKind = pgEnum('entity_kind', [
  'person',
  'organization',
  'place',
  'project',
  'object',
  'other',
]);
export const journeyStatus = pgEnum('journey_status', ['suggested', 'active', 'dormant', 'closed']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'dead']);
