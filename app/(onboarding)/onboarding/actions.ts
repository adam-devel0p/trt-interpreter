'use server';

import { redirect } from 'next/navigation';
import { FIRST_READING_PATH, HOME_PATH, ONBOARDING_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { getProfile, updateProfile, type ProfilePatch } from '@/db/queries/profile';
import {
  isExperienceLevel,
  isUsageStyle,
  resumeStep,
  transition,
  type OnboardingEvent,
  type OnboardingPatch,
} from '@/domain/onboarding/machine';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * One action for every onboarding form. The database row is the source of truth for the
 * current step (a stale tab cannot skip ahead); the machine decides what the event means;
 * the patch is persisted before any redirect, so a drop-off resumes exactly here.
 */
export async function onboardingAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const client = await getSessionClient();
  const profile = await getProfile(client, user.id);
  if (!profile) redirect('/sign-in');

  const current = resumeStep({
    onboardingStep: profile.onboarding_step,
    onboardingCompletedAt: profile.onboarding_completed_at,
  });
  if (current === 'done') redirect(HOME_PATH);

  const event = eventFrom(fd);
  if (!event) redirect(ONBOARDING_PATH);
  const result = transition(current, event, new Date());
  if (result.kind === 'invalid') {
    logger.info('app.onboarding.stale_event', { userId: user.id, status: current });
    redirect(ONBOARDING_PATH);
  }

  try {
    await updateProfile(client, user.id, toProfilePatch(result.patch));
  } catch (err) {
    logger.warn('app.onboarding.write_failed', { userId: user.id, errorClass: errorClassOf(err) });
    redirect(ONBOARDING_PATH);
  }

  if (result.kind === 'done') {
    logger.info('app.onboarding.completed', {
      userId: user.id,
      status: result.patch.aiConsentAt ? 'ai_consented' : 'ai_declined',
    });
    redirect(FIRST_READING_PATH);
  }
  logger.info('app.onboarding.step', { userId: user.id, status: result.step });
  redirect(ONBOARDING_PATH);
}

/**
 * The submitting button's `name` is the event type and its `value` the payload, so a step's
 * several buttons (choices, Back, Skip) never share a field name.
 */
function eventFrom(fd: FormData): OnboardingEvent | null {
  for (const type of ['continue', 'skip', 'back', 'accept_consent', 'decline_consent'] as const) {
    if (fd.has(type)) return { type };
  }
  if (fd.has('choose_usage_style')) {
    const value = fd.get('choose_usage_style');
    return isUsageStyle(value) ? { type: 'choose_usage_style', value } : null;
  }
  if (fd.has('choose_experience')) {
    const value = fd.get('choose_experience');
    return isExperienceLevel(value) ? { type: 'choose_experience', value } : null;
  }
  return null;
}

function toProfilePatch(p: OnboardingPatch): ProfilePatch {
  const out: ProfilePatch = {};
  if (p.onboardingStep !== undefined) out.onboarding_step = p.onboardingStep;
  if (p.onboardingCompletedAt) out.onboarding_completed_at = p.onboardingCompletedAt.toISOString();
  if (p.usageStyle !== undefined) out.usage_style = p.usageStyle;
  if (p.experienceLevel !== undefined) out.experience_level = p.experienceLevel;
  if (p.aiConsentAt !== undefined)
    out.ai_consent_at = p.aiConsentAt ? p.aiConsentAt.toISOString() : null;
  return out;
}
