import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformSql } from '@/db/admin';
import { getProfile, hasAiConsent, setAiConsent, updateProfile } from '@/db/queries/profile';
import { resumeStep, transition } from '@/domain/onboarding/machine';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

describe('profiles: signup → preferences → consent', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await createTestUser('profile');
  });
  afterAll(async () => {
    await deleteTestUser(user);
  });

  it('signup creates exactly one profile row with defaults', async () => {
    const rows = await platformSql()<{ n: number }[]>`
      select count(*)::int as n from profiles where id = ${user.id}`;
    expect(rows[0]?.n).toBe(1);
    const p = await getProfile(user.client, user.id);
    expect(p).toMatchObject({
      id: user.id,
      plan: 'free',
      usage_style: null,
      experience_level: null,
      ai_consent_at: null,
      ai_explanation_depth: 'standard',
      onboarding_step: 0,
      onboarding_completed_at: null,
      use_reversals: true,
    });
  });

  it('preference writes persist and bump updated_at', async () => {
    const before = await getProfile(user.client, user.id);
    await new Promise((r) => setTimeout(r, 5));
    const after = await updateProfile(user.client, user.id, {
      usage_style: 'physical',
      experience_level: 'experienced',
      ai_explanation_depth: 'brief',
      use_reversals: false,
    });
    expect(after.usage_style).toBe('physical');
    expect(after.experience_level).toBe('experienced');
    expect(after.ai_explanation_depth).toBe('brief');
    expect(after.use_reversals).toBe(false);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
    const reread = await getProfile(user.client, user.id);
    expect(reread).toEqual(after);
  });

  it('rejects unknown keys and plan at the query layer', async () => {
    await expect(updateProfile(user.client, user.id, { plan: 'pro' } as never)).rejects.toThrow();
    await expect(
      updateProfile(user.client, user.id, { usage_style: 'telepathic' } as never),
    ).rejects.toThrow();
  });

  it('consent is a timestamp; declining leaves it null', async () => {
    const now = new Date('2026-09-12T12:00:00Z');
    const granted = await setAiConsent(user.client, user.id, true, now);
    expect(new Date(granted.ai_consent_at!).toISOString()).toBe(now.toISOString());
    expect(hasAiConsent(granted)).toBe(true);
    const declined = await setAiConsent(user.client, user.id, false);
    expect(declined.ai_consent_at).toBeNull();
    expect(hasAiConsent(declined)).toBe(false);
  });

  it('onboarding progress persists per step and resumes (decline path)', async () => {
    const now = new Date();
    const step1 = transition('welcome', { type: 'continue' }, now);
    if (step1.kind !== 'step') throw new Error('expected step');
    await updateProfile(user.client, user.id, { onboarding_step: step1.patch.onboardingStep! });
    let p = (await getProfile(user.client, user.id))!;
    expect(
      resumeStep({
        onboardingStep: p.onboarding_step,
        onboardingCompletedAt: p.onboarding_completed_at,
      }),
    ).toBe('usage_style');

    // Drop off and come back: still on usage_style. Skip twice, then decline consent.
    const s2 = transition('usage_style', { type: 'skip' }, now);
    const s3 = transition('experience', { type: 'skip' }, now);
    const done = transition('consent', { type: 'decline_consent' }, now);
    if (s2.kind !== 'step' || s3.kind !== 'step' || done.kind !== 'done')
      throw new Error('bad path');
    await updateProfile(user.client, user.id, { onboarding_step: s3.patch.onboardingStep! });
    await updateProfile(user.client, user.id, {
      onboarding_step: done.patch.onboardingStep!,
      onboarding_completed_at: done.patch.onboardingCompletedAt!.toISOString(),
      ai_consent_at: null,
    });
    p = (await getProfile(user.client, user.id))!;
    expect(p.onboarding_completed_at).not.toBeNull();
    expect(p.ai_consent_at).toBeNull();
    expect(
      resumeStep({
        onboardingStep: p.onboarding_step,
        onboardingCompletedAt: p.onboarding_completed_at,
      }),
    ).toBe('done');
  });
});
