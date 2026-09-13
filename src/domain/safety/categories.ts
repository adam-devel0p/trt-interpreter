/**
 * High-stakes topic handling (spec §10). The reflection always happens; on a hit the UI adds a
 * calm pointer to qualified help once per reading. Categories and severities are stable keys;
 * resource copy is separate and localisable (§13). Nothing here quotes the user's words.
 */
import { z } from 'zod';

export const SAFETY_CATEGORIES = [
  'medical',
  'self_harm',
  'legal',
  'financial',
  'immediate_safety',
  'none',
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const SAFETY_SEVERITIES = ['low', 'medium', 'high'] as const;
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

export const safetyClassificationSchema = z
  .object({
    category: z.enum(SAFETY_CATEGORIES),
    severity: z.enum(SAFETY_SEVERITIES),
  })
  .strict();
export type SafetyClassification = z.infer<typeof safetyClassificationSchema>;

export const NO_FLAG: SafetyClassification = { category: 'none', severity: 'low' };

export interface SafetyResource {
  label: string;
  /** A phone number or a URL; rendered as a link when it is a URL. */
  contact: string;
  region: string;
}

export interface SafetyCopy {
  heading: string;
  body: string;
  resources: SafetyResource[];
}

/**
 * Plain, non-preachy copy (DESIGN_SYSTEM copy rules). Region-specific lines are shown only
 * when the region is known; the international line is always present.
 */
export const SAFETY_COPY: Record<Exclude<SafetyCategory, 'none'>, SafetyCopy> = {
  self_harm: {
    heading: 'If things feel heavy right now',
    body: 'A reading can hold a question, but it is not support. If you are thinking about harming yourself, someone trained to listen is available now, and it is fine to reach out before things get worse.',
    resources: [
      {
        label: 'Find a helpline in your country',
        contact: 'https://findahelpline.com',
        region: 'international',
      },
      { label: '988 Suicide & Crisis Lifeline (call or text)', contact: '988', region: 'US' },
      { label: 'Samaritans (free, 24 hours)', contact: '116 123', region: 'UK/IE' },
    ],
  },
  immediate_safety: {
    heading: 'If you are in danger right now',
    body: 'The reading stays here for later. If you or someone near you is at immediate risk, contact your local emergency number first.',
    resources: [
      { label: 'Local emergency services', contact: '112 / 911 / 999', region: 'international' },
      {
        label: 'Domestic violence helplines by country',
        contact: 'https://findahelpline.com',
        region: 'international',
      },
    ],
  },
  medical: {
    heading: 'A note on health questions',
    body: 'The cards can reflect how you feel about a health question; they cannot diagnose or replace a clinician. If symptoms are worrying you, a doctor or nurse line is the right next step.',
    resources: [],
  },
  legal: {
    heading: 'A note on legal questions',
    body: 'This reflection is not legal advice. For anything with real consequences, a qualified lawyer or a free legal aid service can tell you where you actually stand.',
    resources: [],
  },
  financial: {
    heading: 'A note on money decisions',
    body: 'A reading can surface how a decision feels; it is not financial advice. For decisions that could cost you, an independent adviser or a debt charity is the safer sounding board.',
    resources: [],
  },
};

/** Severity at or above which the resource card is shown. Lower hits are recorded only. */
export const SAFETY_SURFACE_MIN: Record<Exclude<SafetyCategory, 'none'>, SafetySeverity> = {
  self_harm: 'low',
  immediate_safety: 'low',
  medical: 'medium',
  legal: 'medium',
  financial: 'medium',
};

const RANK: Record<SafetySeverity, number> = { low: 0, medium: 1, high: 2 };

export function shouldSurface(c: SafetyClassification): boolean {
  if (c.category === 'none') return false;
  return RANK[c.severity] >= RANK[SAFETY_SURFACE_MIN[c.category]];
}
