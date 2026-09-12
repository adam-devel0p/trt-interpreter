/**
 * Task → tier → model ID routing (docs/AI_LAYER.md). Callers pass a task; nobody outside this
 * file names a model. Model IDs are data (env), so migration is a config change.
 */
import { MODEL_TIERS, TASK_IDS, type ModelTier, type TaskId } from './types';

export const TASK_TIERS: Record<TaskId, ModelTier> = {
  interpret_reading: 'deep',
  classify_safety: 'fast',
  detect_repeat_question: 'fast',
  extract_reading_metadata: 'standard',
  extract_event_metadata: 'standard',
  propose_entity_candidates: 'fast',
  propose_journey: 'standard',
  explain_correlation: 'fast',
  parse_history_query: 'fast',
  answer_from_evidence: 'deep',
  summarize_period: 'standard',
  journey_narrative: 'standard',
  build_retrieval_document: 'fast',
};

/** Default per-tier timeouts (§13 AI resilience). */
export const TIER_TIMEOUT_MS: Record<ModelTier, number> = {
  fast: 15_000,
  standard: 45_000,
  deep: 45_000,
};

export interface ModelRouting {
  models: Record<ModelTier, string>;
  embeddingModel: string;
}

export interface RoutingEnv {
  AI_MODEL_FAST: string;
  AI_MODEL_STANDARD: string;
  AI_MODEL_DEEP: string;
  AI_EMBEDDING_MODEL: string;
}

export function routingFromEnv(env: RoutingEnv): ModelRouting {
  return {
    models: { fast: env.AI_MODEL_FAST, standard: env.AI_MODEL_STANDARD, deep: env.AI_MODEL_DEEP },
    embeddingModel: env.AI_EMBEDDING_MODEL,
  };
}

export function tierForTask(task: TaskId): ModelTier {
  return TASK_TIERS[task];
}

export function modelForTier(routing: ModelRouting, tier: ModelTier): string {
  const id = routing.models[tier];
  if (!id) throw new Error(`No model configured for tier ${tier}`);
  return id;
}

/** One tier cheaper, or null when already at the floor. Used by the timeout policy. */
export function downgradeTier(tier: ModelTier): ModelTier | null {
  const i = MODEL_TIERS.indexOf(tier);
  return i > 0 ? (MODEL_TIERS[i - 1] ?? null) : null;
}

/** Asserted by a test: every TaskId resolves to a tier, every tier to a model ID. */
export function validateRouting(routing: ModelRouting): void {
  for (const task of TASK_IDS) {
    const tier = TASK_TIERS[task];
    if (!MODEL_TIERS.includes(tier)) throw new Error(`Task ${task} has no tier`);
    modelForTier(routing, tier);
  }
  if (!routing.embeddingModel) throw new Error('No embedding model configured');
}
