/**
 * Interpretations, safety flags and question embeddings through the RLS-respecting user
 * client. Nothing here talks to a model; reading a stored interpretation is one PostgREST
 * select (invariant: opening a reading makes zero AI calls). Every model-derived write is
 * wrapped by `modelWrite()` so the fact status can only ever be TAROT_INTERPRETATION.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { modelWrite } from '@/domain/facts/writeGate';
import type { ExplanationDepth } from '@/domain/interpretation/depth';
import {
  interpretationOutputSchema,
  type InterpretationErrorClass,
  type InterpretationOutput,
  type InterpretationStatus,
  type PartialInterpretation,
} from '@/domain/interpretation/schema';
import { normaliseQuestion, type PriorAsk } from '@/domain/interpretation/repeat';
import type { SafetyCategory, SafetySeverity } from '@/domain/safety/categories';

export class InterpretationQueryError extends Error {
  override name = 'InterpretationQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface InterpretationRow {
  id: string;
  reading_id: string;
  user_id: string;
  status: InterpretationStatus;
  fact_status: 'TAROT_INTERPRETATION';
  metadata_version: number;
  depth: ExplanationDepth;
  synthesis: string | null;
  per_card: InterpretationOutput['per_card'] | PartialInterpretation['per_card'] | null;
  combined: string | null;
  reflective_prompts: string[] | null;
  model_id: string | null;
  prompt_version: string;
  schema_version: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_micros: number | null;
  latency_ms: number | null;
  error_class: InterpretationErrorClass | string | null;
  feedback: -1 | 1 | null;
  feedback_reason: string | null;
  feedback_at: string | null;
  superseded_by: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, reading_id, user_id, status, fact_status, metadata_version, depth, synthesis, per_card, ' +
  'combined, reflective_prompts, model_id, prompt_version, schema_version, tokens_in, tokens_out, ' +
  'cost_micros, latency_ms, error_class, feedback, feedback_reason, feedback_at, superseded_by, ' +
  'generated_at, created_at, updated_at';

/** A complete row, typed so the UI can rely on every layer being present. */
export type CompleteInterpretation = InterpretationRow & {
  status: 'complete';
  synthesis: string;
  per_card: InterpretationOutput['per_card'];
  combined: string;
  reflective_prompts: string[];
  model_id: string;
};

export function isComplete(row: InterpretationRow | null): row is CompleteInterpretation {
  return !!row && row.status === 'complete' && row.synthesis !== null && row.per_card !== null;
}

export interface InterpretationState {
  /** The current complete interpretation, if any (never superseded). */
  current: CompleteInterpretation | null;
  /** The most recent row of any status that is not superseded — may be in progress or failed. */
  latest: InterpretationRow | null;
}

/** One select, newest first; the two views are derived in memory. */
export async function getInterpretationState(
  client: UserClient,
  readingId: string,
): Promise<InterpretationState> {
  const { data, error } = await client
    .from('interpretations')
    .select(COLUMNS)
    .eq('reading_id', readingId)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new InterpretationQueryError('interpretation read failed', error.code);
  const rows = (data ?? []) as unknown as InterpretationRow[];
  const current = rows.find(isComplete) ?? null;
  return { current, latest: rows[0] ?? null };
}

export async function getInterpretation(
  client: UserClient,
  id: string,
): Promise<InterpretationRow | null> {
  const { data, error } = await client
    .from('interpretations')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new InterpretationQueryError('interpretation read failed', error.code);
  return (data as unknown as InterpretationRow | null) ?? null;
}

export interface CreatePendingInput {
  readingId: string;
  userId: string;
  metadataVersion: number;
  depth: ExplanationDepth;
  promptVersion: string;
  schemaVersion: string;
}

/** The row exists before the model is called, so a crash mid-stream still leaves a record. */
export async function createPendingInterpretation(
  client: UserClient,
  input: CreatePendingInput,
): Promise<InterpretationRow> {
  const gated = modelWrite('TAROT_INTERPRETATION', {
    reading_id: input.readingId,
    user_id: input.userId,
    status: 'pending' as const,
    metadata_version: input.metadataVersion,
    depth: input.depth,
    prompt_version: input.promptVersion,
    schema_version: input.schemaVersion,
  });
  const { data, error } = await client
    .from('interpretations')
    .insert({ ...gated.payload, fact_status: gated.fact_status })
    .select(COLUMNS)
    .single();
  if (error) throw new InterpretationQueryError('interpretation create failed', error.code);
  return data as unknown as InterpretationRow;
}

/** Partial layers while streaming; called on a throttle, never per token. */
export async function updateInterpretationPartial(
  client: UserClient,
  id: string,
  partial: PartialInterpretation,
): Promise<void> {
  const gated = modelWrite('TAROT_INTERPRETATION', {
    status: 'streaming' as const,
    synthesis: partial.synthesis ?? null,
    per_card: partial.per_card ?? null,
    combined: partial.combined ?? null,
    reflective_prompts: partial.reflective_prompts ?? null,
  });
  const { error } = await client
    .from('interpretations')
    .update(gated.payload)
    .eq('id', id)
    .neq('status', 'complete');
  if (error) throw new InterpretationQueryError('interpretation update failed', error.code);
}

export interface CompleteInput {
  output: InterpretationOutput;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  latencyMs: number;
}

/**
 * Mark complete. Any previous current interpretation for the reading is superseded first, so
 * the partial unique index holds and the old row stays for reproducibility.
 */
export async function completeInterpretation(
  client: UserClient,
  id: string,
  readingId: string,
  input: CompleteInput,
): Promise<InterpretationRow> {
  const output = interpretationOutputSchema.parse(input.output);
  const gated = modelWrite('TAROT_INTERPRETATION', {
    status: 'complete' as const,
    synthesis: output.synthesis,
    per_card: output.per_card,
    combined: output.combined,
    reflective_prompts: output.reflective_prompts,
    model_id: input.modelId,
    prompt_version: input.promptVersion,
    schema_version: input.schemaVersion,
    tokens_in: input.tokensIn,
    tokens_out: input.tokensOut,
    cost_micros: input.costMicros,
    latency_ms: input.latencyMs,
    error_class: null,
    generated_at: new Date().toISOString(),
  });
  const supersede = await client
    .from('interpretations')
    .update({ superseded_by: id })
    .eq('reading_id', readingId)
    .eq('status', 'complete')
    .is('superseded_by', null)
    .neq('id', id);
  if (supersede.error) {
    throw new InterpretationQueryError('interpretation supersede failed', supersede.error.code);
  }
  const { data, error } = await client
    .from('interpretations')
    .update(gated.payload)
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw new InterpretationQueryError('interpretation complete failed', error.code);
  return data as unknown as InterpretationRow;
}

/** Terminal failure; partial layers already stored are kept. */
export async function failInterpretation(
  client: UserClient,
  id: string,
  errorClass: InterpretationErrorClass | string,
  meta?: { modelId?: string; latencyMs?: number },
): Promise<void> {
  const { error } = await client
    .from('interpretations')
    .update({
      status: 'failed',
      error_class: errorClass,
      model_id: meta?.modelId ?? null,
      latency_ms: meta?.latencyMs ?? null,
    })
    .eq('id', id)
    .neq('status', 'complete');
  if (error) throw new InterpretationQueryError('interpretation fail failed', error.code);
}

export const FEEDBACK_REASON_MAX = 280;

/** Thumbs + optional reason (§16). The reason is the user's own words — treated as journal content. */
export async function setInterpretationFeedback(
  client: UserClient,
  id: string,
  feedback: -1 | 1 | null,
  reason: string | null,
): Promise<void> {
  const clean = z
    .object({
      feedback: z.union([z.literal(-1), z.literal(1)]).nullable(),
      reason: z.string().max(FEEDBACK_REASON_MAX).nullable(),
    })
    .parse({ feedback, reason });
  const { data, error } = await client
    .from('interpretations')
    .update({
      feedback: clean.feedback,
      feedback_reason: clean.feedback === null ? null : clean.reason?.trim() || null,
      feedback_at: clean.feedback === null ? null : new Date().toISOString(),
    })
    .eq('id', id)
    .select('id');
  if (error) throw new InterpretationQueryError('feedback update failed', error.code);
  if (!data?.length) throw new InterpretationQueryError('interpretation not found', 'P0002');
}

// ── Safety flags (§10) ────────────────────────────────────────────────────────────────────

export interface SafetyFlagRow {
  id: string;
  user_id: string;
  object_type: string;
  object_id: string;
  category: Exclude<SafetyCategory, 'none'>;
  severity: SafetySeverity;
  surfaced_at: string | null;
  resource_shown: string | null;
  created_at: string;
}

const FLAG_COLUMNS =
  'id, user_id, object_type, object_id, category, severity, surfaced_at, resource_shown, created_at';

/** Idempotent per (object, category). Records category and IDs only — never the question. */
export async function recordSafetyFlag(
  client: UserClient,
  input: {
    userId: string;
    objectType: 'reading';
    objectId: string;
    category: Exclude<SafetyCategory, 'none'>;
    severity: SafetySeverity;
    surfaced: boolean;
  },
): Promise<SafetyFlagRow> {
  const { data, error } = await client
    .from('safety_flags')
    .upsert(
      {
        user_id: input.userId,
        object_type: input.objectType,
        object_id: input.objectId,
        category: input.category,
        severity: input.severity,
        surfaced_at: input.surfaced ? new Date().toISOString() : null,
        resource_shown: input.surfaced ? input.category : null,
      },
      { onConflict: 'object_type,object_id,category' },
    )
    .select(FLAG_COLUMNS)
    .single();
  if (error) throw new InterpretationQueryError('safety flag write failed', error.code);
  return data as unknown as SafetyFlagRow;
}

export async function listSafetyFlags(
  client: UserClient,
  objectType: 'reading',
  objectId: string,
): Promise<SafetyFlagRow[]> {
  const { data, error } = await client
    .from('safety_flags')
    .select(FLAG_COLUMNS)
    .eq('object_type', objectType)
    .eq('object_id', objectId);
  if (error) throw new InterpretationQueryError('safety flag read failed', error.code);
  return (data ?? []) as unknown as SafetyFlagRow[];
}

// ── Question embeddings (FR-25) ───────────────────────────────────────────────────────────

function parseVector(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') return JSON.parse(v) as number[];
  return [];
}

export function questionHash(question: string): string {
  // FNV-1a over the normalised text: a stable key, not a secret; never reversible to prose.
  const s = normaliseQuestion(question);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}

/** The user's asks in the last 24 hours (bounded), vectors parsed, for the domain rule. */
export async function listRecentQuestionAsks(
  client: UserClient,
  userId: string,
  since: Date,
  limit = 60,
): Promise<PriorAsk[]> {
  const { data, error } = await client
    .from('question_embeddings')
    .select('reading_id, vector, asked_at, nudge_shown_at')
    .eq('user_id', userId)
    .gte('asked_at', since.toISOString())
    .order('asked_at', { ascending: false })
    .limit(limit);
  if (error) throw new InterpretationQueryError('question embeddings read failed', error.code);
  return (
    (data ?? []) as {
      reading_id: string | null;
      vector: unknown;
      asked_at: string;
      nudge_shown_at: string | null;
    }[]
  ).map((r) => ({
    readingId: r.reading_id,
    vector: parseVector(r.vector),
    askedAt: r.asked_at,
    nudgeShownAt: r.nudge_shown_at,
  }));
}

export async function insertQuestionAsk(
  client: UserClient,
  input: { userId: string; question: string; vector: number[]; model: string; nudgeShown: boolean },
): Promise<string> {
  const { data, error } = await client
    .from('question_embeddings')
    .insert({
      user_id: input.userId,
      question_hash: questionHash(input.question),
      vector: JSON.stringify(input.vector),
      model: input.model,
      nudge_shown_at: input.nudgeShown ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) throw new InterpretationQueryError('question embedding write failed', error.code);
  return (data as { id: string }).id;
}

/** On save: attach the latest unlinked ask with this question's hash to the new reading. */
export async function linkQuestionAsk(
  client: UserClient,
  userId: string,
  question: string,
  readingId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('question_embeddings')
    .select('id')
    .eq('user_id', userId)
    .eq('question_hash', questionHash(question))
    .is('reading_id', null)
    .order('asked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new InterpretationQueryError('question embedding read failed', error.code);
  if (!data) return false;
  const upd = await client
    .from('question_embeddings')
    .update({ reading_id: readingId })
    .eq('id', (data as { id: string }).id);
  if (upd.error)
    throw new InterpretationQueryError('question embedding link failed', upd.error.code);
  return true;
}
