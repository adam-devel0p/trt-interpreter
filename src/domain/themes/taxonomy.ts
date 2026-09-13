/**
 * Theme taxonomy (spec §13: stable machine keys, localisable labels). The curated list is
 * seeded as global `themes` rows (`user_id` null). The model proposes free-text labels;
 * `resolveThemeLabel()` maps a label onto a curated slug when it matches a slug, label or
 * synonym, otherwise the label becomes a user-scoped theme under a slug derived from it.
 */
import type { ThemeCategory } from '../extraction/schema';

export interface CuratedTheme {
  slug: string;
  label: string;
  category: ThemeCategory;
  synonyms: readonly string[];
}

export const CURATED_THEMES: readonly CuratedTheme[] = [
  {
    slug: 'uncertainty',
    label: 'Uncertainty',
    category: 'emotional',
    synonyms: ['doubt', 'unsure', 'not knowing', 'indecision', 'ambivalence'],
  },
  {
    slug: 'anxiety',
    label: 'Anxiety',
    category: 'emotional',
    synonyms: ['worry', 'stress', 'nervousness', 'overwhelm', 'pressure'],
  },
  { slug: 'fear', label: 'Fear', category: 'emotional', synonyms: ['dread', 'afraid', 'scared'] },
  {
    slug: 'hope',
    label: 'Hope',
    category: 'emotional',
    synonyms: ['optimism', 'anticipation', 'looking forward'],
  },
  {
    slug: 'grief',
    label: 'Grief',
    category: 'emotional',
    synonyms: ['loss', 'mourning', 'sadness', 'bereavement'],
  },
  {
    slug: 'confidence',
    label: 'Confidence',
    category: 'emotional',
    synonyms: ['self-belief', 'self-trust', 'quiet confidence', 'assurance'],
  },
  {
    slug: 'restlessness',
    label: 'Restlessness',
    category: 'emotional',
    synonyms: ['impatience', 'itch for change', 'waiting'],
  },
  {
    slug: 'relief',
    label: 'Relief',
    category: 'emotional',
    synonyms: ['release', 'letting go', 'closure'],
  },
  {
    slug: 'conflict',
    label: 'Conflict',
    category: 'relational',
    synonyms: ['tension', 'argument', 'strife', 'friction', 'disagreement'],
  },
  {
    slug: 'trust',
    label: 'Trust',
    category: 'relational',
    synonyms: ['honesty', 'openness', 'betrayal'],
  },
  {
    slug: 'distance',
    label: 'Distance',
    category: 'relational',
    synonyms: ['drifting apart', 'long distance', 'estrangement', 'silence'],
  },
  {
    slug: 'communication',
    label: 'Communication',
    category: 'relational',
    synonyms: ['conversation', 'talking', 'saying it', 'a difficult conversation'],
  },
  {
    slug: 'commitment',
    label: 'Commitment',
    category: 'relational',
    synonyms: ['devotion', 'loyalty', 'staying'],
  },
  {
    slug: 'boundaries',
    label: 'Boundaries',
    category: 'relational',
    synonyms: ['limits', 'saying no', 'taking over', 'space'],
  },
  {
    slug: 'care',
    label: 'Care',
    category: 'relational',
    synonyms: ['support', 'looking after', 'caregiving', 'tenderness'],
  },
  {
    slug: 'decision',
    label: 'Decision',
    category: 'situational',
    synonyms: ['choice', 'crossroads', 'deciding', 'a fork in the road', 'yes or no'],
  },
  {
    slug: 'change',
    label: 'Change',
    category: 'situational',
    synonyms: ['transition', 'upheaval', 'a new chapter', 'moving on', 'shift'],
  },
  {
    slug: 'stability',
    label: 'Stability',
    category: 'situational',
    synonyms: ['steadiness', 'security', 'ground', 'routine', 'settling'],
  },
  {
    slug: 'endings',
    label: 'Endings',
    category: 'situational',
    synonyms: ['ending', 'walking away', 'leaving', 'closing a cycle', 'completion'],
  },
  {
    slug: 'beginnings',
    label: 'Beginnings',
    category: 'situational',
    synonyms: ['a new start', 'starting over', 'fresh start', 'opening'],
  },
  {
    slug: 'growth',
    label: 'Growth',
    category: 'situational',
    synonyms: ['learning', 'development', 'becoming', 'maturing'],
  },
  {
    slug: 'patience',
    label: 'Patience',
    category: 'situational',
    synonyms: ['slowing down', 'taking time', 'slow down', 'pacing'],
  },
  {
    slug: 'ambition',
    label: 'Ambition',
    category: 'practical',
    synonyms: ['career growth', 'promotion', 'advancement', 'recognition', 'a step up'],
  },
  {
    slug: 'money_pressure',
    label: 'Money pressure',
    category: 'practical',
    synonyms: ['money', 'finances', 'debt', 'spending', 'affordability', 'financial strain'],
  },
  {
    slug: 'work_life',
    label: 'Work and life',
    category: 'practical',
    synonyms: ['work-life balance', 'evenings', 'overwork', 'time for myself', 'burnout'],
  },
  {
    slug: 'home',
    label: 'Home',
    category: 'practical',
    synonyms: ['moving house', 'a move', 'relocation', 'the flat', 'housing'],
  },
  {
    slug: 'health',
    label: 'Health',
    category: 'practical',
    synonyms: ['wellbeing', 'the body', 'illness', 'energy', 'rest'],
  },
  {
    slug: 'creativity',
    label: 'Creativity',
    category: 'practical',
    synonyms: ['making things', 'a side project', 'the craft', 'inspiration'],
  },
  {
    slug: 'family',
    label: 'Family',
    category: 'relational',
    synonyms: ['parents', 'siblings', 'the family', 'a family matter'],
  },
  {
    slug: 'independence',
    label: 'Independence',
    category: 'situational',
    synonyms: ['autonomy', 'standing on my own', 'self-reliance', 'freedom'],
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A URL-safe key for a free-text theme label. */
export function slugifyTheme(label: string): string {
  return norm(label).replace(/\s+/g, '_').slice(0, 48) || 'theme';
}

/** The curated theme a free-text label maps onto, or null when it is a new, user-scoped theme. */
export function resolveThemeLabel(label: string): CuratedTheme | null {
  const key = norm(label);
  if (!key) return null;
  const slug = slugifyTheme(label);
  for (const t of CURATED_THEMES) {
    if (t.slug === slug || norm(t.label) === key) return t;
    if (t.synonyms.some((s) => norm(s) === key)) return t;
  }
  return null;
}

export function curatedTheme(slug: string): CuratedTheme | null {
  return CURATED_THEMES.find((t) => t.slug === slug) ?? null;
}
