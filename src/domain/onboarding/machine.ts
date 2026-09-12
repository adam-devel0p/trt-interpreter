/**
 * Onboarding state machine (spec §6.1; docs/phases/phase-01-auth-onboarding.md §3).
 *
 * Five screens, in exactly this order. The first four are steps with one action each; the
 * fifth is the exit into the first reading. Progress is stored as the index of the step the
 * user is currently on (`profiles.onboarding_step`), so a drop-off resumes, never restarts.
 *
 * Pure: no I/O. The server action layer persists `Transition.patch` and redirects.
 */

export const ONBOARDING_STEPS = ['welcome', 'usage_style', 'experience', 'consent'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const USAGE_STYLES = ['digital', 'physical', 'both'] as const;
export type UsageStyle = (typeof USAGE_STYLES)[number];

export const EXPERIENCE_LEVELS = ['beginner', 'comfortable', 'experienced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** The slice of a profile the machine reads. */
export interface OnboardingProgress {
  onboardingStep: number;
  onboardingCompletedAt: string | Date | null;
}

/** What a step's action writes back. Only the keys present are persisted. */
export interface OnboardingPatch {
  onboardingStep?: number;
  onboardingCompletedAt?: Date;
  usageStyle?: UsageStyle | null;
  experienceLevel?: ExperienceLevel | null;
  /** `null` = declined (recorded as no consent); `Date` = consented at. */
  aiConsentAt?: Date | null;
}

export type OnboardingEvent =
  | { type: 'continue' } // welcome → usage_style
  | { type: 'choose_usage_style'; value: UsageStyle }
  | { type: 'choose_experience'; value: ExperienceLevel }
  | { type: 'skip' } // usage_style and experience only
  | { type: 'accept_consent' }
  | { type: 'decline_consent' }
  | { type: 'back' };

export type Transition =
  | { kind: 'step'; step: OnboardingStep; patch: OnboardingPatch }
  | { kind: 'done'; patch: OnboardingPatch }
  | { kind: 'invalid'; reason: string };

/** Which steps may be skipped. Consent is never skipped: it is accepted or declined. */
export const SKIPPABLE_STEPS: ReadonlySet<OnboardingStep> = new Set(['usage_style', 'experience']);

export function stepAt(index: number): OnboardingStep {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), ONBOARDING_STEPS.length - 1);
  return ONBOARDING_STEPS[clamped]!;
}

export function indexOf(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** Where a user resumes: the completed flow, or the step they were on. */
export function resumeStep(progress: OnboardingProgress): OnboardingStep | 'done' {
  if (progress.onboardingCompletedAt) return 'done';
  return stepAt(progress.onboardingStep);
}

export function isUsageStyle(v: unknown): v is UsageStyle {
  return typeof v === 'string' && (USAGE_STYLES as readonly string[]).includes(v);
}

export function isExperienceLevel(v: unknown): v is ExperienceLevel {
  return typeof v === 'string' && (EXPERIENCE_LEVELS as readonly string[]).includes(v);
}

function forward(from: OnboardingStep, patch: OnboardingPatch, now: Date): Transition {
  const next = indexOf(from) + 1;
  if (next >= ONBOARDING_STEPS.length) {
    return { kind: 'done', patch: { ...patch, onboardingStep: next, onboardingCompletedAt: now } };
  }
  return { kind: 'step', step: ONBOARDING_STEPS[next]!, patch: { ...patch, onboardingStep: next } };
}

/**
 * Apply an event to the current step. Returns the next step (with the patch to persist), the
 * completed flow, or `invalid` when the event does not belong to this step — an invalid event
 * is a stale form, not an error the user caused; the caller re-renders the current step.
 */
export function transition(current: OnboardingStep, event: OnboardingEvent, now: Date): Transition {
  if (event.type === 'back') {
    const prev = indexOf(current) - 1;
    if (prev < 0) return { kind: 'invalid', reason: 'already at the first step' };
    return { kind: 'step', step: ONBOARDING_STEPS[prev]!, patch: { onboardingStep: prev } };
  }
  if (event.type === 'skip') {
    if (!SKIPPABLE_STEPS.has(current))
      return { kind: 'invalid', reason: `${current} is not skippable` };
    return forward(current, {}, now);
  }
  switch (current) {
    case 'welcome':
      if (event.type === 'continue') return forward(current, {}, now);
      break;
    case 'usage_style':
      if (event.type === 'choose_usage_style')
        return forward(current, { usageStyle: event.value }, now);
      break;
    case 'experience':
      if (event.type === 'choose_experience')
        return forward(current, { experienceLevel: event.value }, now);
      break;
    case 'consent':
      if (event.type === 'accept_consent') return forward(current, { aiConsentAt: now }, now);
      if (event.type === 'decline_consent') return forward(current, { aiConsentAt: null }, now);
      break;
  }
  return { kind: 'invalid', reason: `${event.type} is not valid on ${current}` };
}
