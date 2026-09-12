import { redirect } from 'next/navigation';
import { HOME_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { getProfile } from '@/db/queries/profile';
import { resumeStep } from '@/domain/onboarding/machine';
import { OnboardingStepView } from './steps';

export const metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getProfile(await getSessionClient(), user.id);
  if (!profile) redirect('/sign-in');
  const step = resumeStep({
    onboardingStep: profile.onboarding_step,
    onboardingCompletedAt: profile.onboarding_completed_at,
  });
  if (step === 'done') redirect(HOME_PATH);
  return <OnboardingStepView step={step} profile={profile} />;
}
