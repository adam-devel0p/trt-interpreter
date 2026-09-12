import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  resumeStep,
  SKIPPABLE_STEPS,
  stepAt,
  transition,
  type OnboardingStep,
} from '../machine';

const now = new Date('2026-09-12T10:00:00Z');

describe('onboarding machine', () => {
  it('has exactly the §6.1 step order', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'usage_style', 'experience', 'consent']);
  });

  it('walks the happy path and completes with a consent timestamp', () => {
    let t = transition('welcome', { type: 'continue' }, now);
    expect(t).toEqual({ kind: 'step', step: 'usage_style', patch: { onboardingStep: 1 } });
    t = transition('usage_style', { type: 'choose_usage_style', value: 'both' }, now);
    expect(t).toEqual({
      kind: 'step',
      step: 'experience',
      patch: { onboardingStep: 2, usageStyle: 'both' },
    });
    t = transition('experience', { type: 'choose_experience', value: 'beginner' }, now);
    expect(t).toEqual({
      kind: 'step',
      step: 'consent',
      patch: { onboardingStep: 3, experienceLevel: 'beginner' },
    });
    t = transition('consent', { type: 'accept_consent' }, now);
    expect(t).toEqual({
      kind: 'done',
      patch: { onboardingStep: 4, aiConsentAt: now, onboardingCompletedAt: now },
    });
  });

  it('declining consent completes onboarding with ai_consent left null', () => {
    const t = transition('consent', { type: 'decline_consent' }, now);
    expect(t).toEqual({
      kind: 'done',
      patch: { onboardingStep: 4, aiConsentAt: null, onboardingCompletedAt: now },
    });
  });

  it('skips only the optional steps', () => {
    expect([...SKIPPABLE_STEPS]).toEqual(['usage_style', 'experience']);
    expect(transition('usage_style', { type: 'skip' }, now)).toEqual({
      kind: 'step',
      step: 'experience',
      patch: { onboardingStep: 2 },
    });
    expect(transition('experience', { type: 'skip' }, now)).toEqual({
      kind: 'step',
      step: 'consent',
      patch: { onboardingStep: 3 },
    });
    expect(transition('consent', { type: 'skip' }, now).kind).toBe('invalid');
    expect(transition('welcome', { type: 'skip' }, now).kind).toBe('invalid');
  });

  it('goes back one step and never before the first', () => {
    expect(transition('consent', { type: 'back' }, now)).toEqual({
      kind: 'step',
      step: 'experience',
      patch: { onboardingStep: 2 },
    });
    expect(transition('welcome', { type: 'back' }, now).kind).toBe('invalid');
  });

  it('rejects an event that belongs to a different step (stale form)', () => {
    expect(transition('welcome', { type: 'accept_consent' }, now).kind).toBe('invalid');
    expect(transition('consent', { type: 'choose_usage_style', value: 'digital' }, now).kind).toBe(
      'invalid',
    );
  });

  it('resumes at the stored step, or reports done', () => {
    expect(resumeStep({ onboardingStep: 0, onboardingCompletedAt: null })).toBe('welcome');
    expect(resumeStep({ onboardingStep: 2, onboardingCompletedAt: null })).toBe('experience');
    expect(resumeStep({ onboardingStep: 3, onboardingCompletedAt: null })).toBe('consent');
    expect(resumeStep({ onboardingStep: 1, onboardingCompletedAt: now })).toBe('done');
    // Out-of-range values clamp instead of throwing (a bad row must not lock a user out).
    expect(stepAt(-3)).toBe('welcome');
    expect(stepAt(99)).toBe('consent');
  });

  it('every step reaches done in at most four actions without a skip', () => {
    const drive = (step: OnboardingStep) => {
      let current: OnboardingStep | 'done' = step;
      let actions = 0;
      while (current !== 'done') {
        const ev =
          current === 'welcome'
            ? ({ type: 'continue' } as const)
            : current === 'usage_style'
              ? ({ type: 'choose_usage_style', value: 'digital' } as const)
              : current === 'experience'
                ? ({ type: 'choose_experience', value: 'comfortable' } as const)
                : ({ type: 'accept_consent' } as const);
        const t = transition(current, ev, now);
        if (t.kind === 'invalid') throw new Error(t.reason);
        current = t.kind === 'done' ? 'done' : t.step;
        actions += 1;
      }
      return actions;
    };
    expect(drive('welcome')).toBe(4);
    expect(drive('consent')).toBe(1);
  });
});
