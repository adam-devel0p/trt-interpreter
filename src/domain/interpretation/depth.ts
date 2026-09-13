/**
 * Depth follows the user (spec §9.3 rule 7): `profiles.ai_explanation_depth` sets the length,
 * `experience_level = 'experienced'` shortens it one step and keeps the AI layers folded
 * beneath the user's own note. Pure and tested.
 */

export type ExplanationDepth = 'brief' | 'standard' | 'deep';
export type ExperienceLevel = 'beginner' | 'comfortable' | 'experienced';

export interface DepthProfile {
  ai_explanation_depth: ExplanationDepth;
  experience_level: ExperienceLevel | null;
}

export interface DepthPlan {
  depth: ExplanationDepth;
  /** Guidance sentence for the prompt. */
  perCardSentences: string;
  combinedSentences: string;
  nuancesMax: number;
  maxTokens: number;
  /** Experienced readers get the AI layers folded by default; their own note leads (§9.3). */
  collapsedByDefault: boolean;
  experienced: boolean;
}

const PLANS: Record<ExplanationDepth, Omit<DepthPlan, 'collapsedByDefault' | 'experienced'>> = {
  brief: {
    depth: 'brief',
    perCardSentences: 'one or two sentences',
    combinedSentences: 'two or three sentences',
    nuancesMax: 1,
    maxTokens: 1100,
  },
  standard: {
    depth: 'standard',
    perCardSentences: 'two to four sentences',
    combinedSentences: 'three to five sentences',
    nuancesMax: 2,
    maxTokens: 1800,
  },
  deep: {
    depth: 'deep',
    perCardSentences: 'four to six sentences',
    combinedSentences: 'five to eight sentences',
    nuancesMax: 3,
    maxTokens: 2800,
  },
};

const SHORTER: Record<ExplanationDepth, ExplanationDepth> = {
  deep: 'standard',
  standard: 'brief',
  brief: 'brief',
};

export function selectDepth(profile: DepthProfile): DepthPlan {
  const experienced = profile.experience_level === 'experienced';
  const depth = experienced ? SHORTER[profile.ai_explanation_depth] : profile.ai_explanation_depth;
  return { ...PLANS[depth], collapsedByDefault: experienced, experienced };
}
