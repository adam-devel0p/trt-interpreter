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

// ── Identity & preferences (Phase 01, docs/DATA_MODEL.md#identity--preferences--phase-01) ──
export const usageStyle = pgEnum('usage_style', ['digital', 'physical', 'both']);
export const experienceLevel = pgEnum('experience_level', [
  'beginner',
  'comfortable',
  'experienced',
]);
export const explanationDepth = pgEnum('explanation_depth', ['brief', 'standard', 'deep']);
export const flagSetBy = pgEnum('flag_set_by', ['user', 'admin', 'rollout']);
export const reminderChannel = pgEnum('reminder_channel', ['push', 'email', 'none']);

// ── Deck reference layer (Phase 02, docs/DATA_MODEL.md#deck-reference-layer--phase-02) ──
export const arcana = pgEnum('arcana', ['major', 'minor']);
export const artStrategy = pgEnum('art_strategy', [
  'bundled_public_domain',
  'original_commissioned',
  'text_only',
]);
export const aliasKind = pgEnum('alias_kind', ['search', 'cross_deck', 'historical']);
