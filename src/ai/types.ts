import type { z } from 'zod';

/** Every task in the catalogue (docs/AI_LAYER.md#task-catalogue), implemented or not. */
export const TASK_IDS = [
  'interpret_reading',
  'classify_safety',
  'detect_repeat_question',
  'extract_reading_metadata',
  'extract_event_metadata',
  'propose_entity_candidates',
  'propose_journey',
  'explain_correlation',
  'parse_history_query',
  'answer_from_evidence',
  'summarize_period',
  'journey_narrative',
  'build_retrieval_document',
] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const MODEL_TIERS = ['fast', 'standard', 'deep'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** Logged for provenance; never content. */
export interface ObjectRef {
  type: string;
  id: string;
}

export interface ObjectRequest<T> {
  task: TaskId;
  system: string;
  messages: Message[];
  schema: z.ZodType<T>;
  modelHint?: ModelTier;
  maxTokens: number;
  timeoutMs?: number;
  userId?: string;
  objectRefs?: ObjectRef[];
  /** Optional named fixture for the mock provider / evals. Ignored by real providers. */
  fixture?: string;
}

export interface ResultMeta {
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  latencyMs: number;
  repaired: boolean;
}

export interface ObjectResult<T> {
  value: T;
  meta: ResultMeta;
}

export interface StreamRequest {
  task: TaskId;
  system: string;
  messages: Message[];
  modelHint?: ModelTier;
  maxTokens: number;
  timeoutMs?: number;
  userId?: string;
  objectRefs?: ObjectRef[];
  fixture?: string;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'done'; meta: ResultMeta }
  | { type: 'error'; errorClass: ProviderErrorClass };

export interface EmbedRequest {
  task: TaskId;
  texts: string[];
  userId?: string;
  objectRefs?: ObjectRef[];
}

export interface EmbedResult {
  vectors: number[][];
  meta: { modelId: string; modelVersion: string; tokensIn: number; costMicros: number };
}

/** What a provider call is being asked to do, after the registry resolved the model. */
export interface ResolvedCall {
  modelId: string;
  tier: ModelTier;
  signal: AbortSignal;
}

/** Content-free classification of provider failures. Persisted to ai_calls.error_class. */
export type ProviderErrorClass =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_output'
  | 'refusal'
  | 'unsupported'
  | 'circuit_open'
  | 'budget_denied'
  | 'unknown';

/** Terminal status of a run. Mirrors ai_calls.status (+ refusal). */
export type RunStatus =
  'ok' | 'invalid_output' | 'timeout' | 'provider_error' | 'budget_denied' | 'refusal';
