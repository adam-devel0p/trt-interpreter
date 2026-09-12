import { describe, expect, it } from 'vitest';
import {
  downgradeTier,
  modelForTier,
  routingFromEnv,
  TASK_TIERS,
  tierForTask,
  validateRouting,
} from '../registry';
import { MODEL_TIERS, TASK_IDS } from '../types';

const env = {
  AI_MODEL_FAST: 'fast-model',
  AI_MODEL_STANDARD: 'standard-model',
  AI_MODEL_DEEP: 'deep-model',
  AI_EMBEDDING_MODEL: 'embed-model',
};

describe('registry', () => {
  it('every TaskId resolves to a tier and every tier to a model ID', () => {
    const routing = routingFromEnv(env);
    for (const task of TASK_IDS) {
      const tier = tierForTask(task);
      expect(MODEL_TIERS).toContain(tier);
      expect(modelForTier(routing, tier)).toMatch(/-model$/);
    }
    expect(Object.keys(TASK_TIERS).sort()).toEqual([...TASK_IDS].sort());
    expect(() => validateRouting(routing)).not.toThrow();
  });

  it('fails loudly when a tier has no model', () => {
    const routing = routingFromEnv({ ...env, AI_MODEL_DEEP: '' });
    expect(() => validateRouting(routing)).toThrow(/deep/);
  });

  it('downgrades one tier at a time and stops at fast', () => {
    expect(downgradeTier('deep')).toBe('standard');
    expect(downgradeTier('standard')).toBe('fast');
    expect(downgradeTier('fast')).toBeNull();
  });
});
