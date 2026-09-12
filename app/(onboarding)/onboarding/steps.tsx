import Link from 'next/link';
import type { ProfileRow } from '@/db/queries/profile';
import { indexOf, ONBOARDING_STEPS, type OnboardingStep } from '@/domain/onboarding/machine';
import { Button } from '@/ui/components/button';
import { ChoiceButton } from '@/ui/components/choice-button';
import { FocusHeading } from '@/ui/components/focus-heading';
import { onboardingAction } from './actions';

/**
 * The four onboarding screens (§6.1). Copy is the product: short, plain, no legal register.
 * Every screen: eyebrow with progress, focused heading, one action per control. Server-
 * rendered; the only client piece is the heading focus.
 */
export function OnboardingStepView({
  step,
  profile,
}: {
  step: OnboardingStep;
  profile: ProfileRow;
}) {
  const n = indexOf(step) + 1;
  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">
        Step {n} of {ONBOARDING_STEPS.length}
      </p>
      {step === 'welcome' && <Welcome />}
      {step === 'usage_style' && <UsageStyle current={profile.usage_style} />}
      {step === 'experience' && <Experience current={profile.experience_level} />}
      {step === 'consent' && <Consent />}
    </div>
  );
}

function Welcome() {
  return (
    <form action={onboardingAction} className="flex flex-1 flex-col">
      <FocusHeading key="welcome">See how your readings connect over time.</FocusHeading>
      <div className="mt-auto pt-10">
        <Button type="submit" name="continue" value="1" size="lg" className="w-full">
          {"Let's begin"}
        </Button>
      </div>
    </form>
  );
}

function BackAndSkip({ skippable }: { skippable: boolean }) {
  return (
    <div className="mt-auto flex items-center justify-between pt-8">
      <Button type="submit" name="back" value="1" variant="ghost">
        Back
      </Button>
      {skippable ? (
        <Button type="submit" name="skip" value="1" variant="ghost">
          Skip
        </Button>
      ) : null}
    </div>
  );
}

function UsageStyle({ current }: { current: ProfileRow['usage_style'] }) {
  return (
    <form action={onboardingAction} className="flex flex-1 flex-col">
      <FocusHeading key="usage_style">How do you usually read?</FocusHeading>
      <p className="mt-2 text-sm text-fg-muted">
        This only sets what you see first. Every way of reading stays available to you.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <ChoiceButton
          name="choose_usage_style"
          value="digital"
          title="I draw digitally"
          description="Shuffle and draw in the app."
          selected={current === 'digital'}
        />
        <ChoiceButton
          name="choose_usage_style"
          value="physical"
          title="I use my own deck"
          description="Log the cards you drew by hand."
          selected={current === 'physical'}
        />
        <ChoiceButton
          name="choose_usage_style"
          value="both"
          title="Both"
          selected={current === 'both'}
        />
      </div>
      <BackAndSkip skippable />
    </form>
  );
}

function Experience({ current }: { current: ProfileRow['experience_level'] }) {
  return (
    <form action={onboardingAction} className="flex flex-1 flex-col">
      <FocusHeading key="experience">How familiar are you with tarot?</FocusHeading>
      <p className="mt-2 text-sm text-fg-muted">
        Optional. It only changes how much explanation you get alongside a card.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <ChoiceButton
          name="choose_experience"
          value="beginner"
          title="Just starting"
          description="Explain the cards as we go."
          selected={current === 'beginner'}
        />
        <ChoiceButton
          name="choose_experience"
          value="comfortable"
          title="Comfortable"
          description="A reminder now and then is enough."
          selected={current === 'comfortable'}
        />
        <ChoiceButton
          name="choose_experience"
          value="experienced"
          title="Experienced"
          description="Keep explanations short."
          selected={current === 'experienced'}
        />
      </div>
      <BackAndSkip skippable />
    </form>
  );
}

function Consent() {
  return (
    <form action={onboardingAction} className="flex flex-1 flex-col">
      <FocusHeading key="consent">Your journal is private.</FocusHeading>
      <div className="prose-content mt-4 flex flex-col gap-3 text-fg">
        <p>Only you can read what you write. Nothing here is shared or sold.</p>
        <p>
          If you allow it, we can send your readings and notes to an AI model to offer an
          interpretation and, later, to notice connections across time. Only the minimum needed for
          each request is sent, and the model never has the final word.
        </p>
        <p>
          You can turn this off at any time in Profile, and export or delete everything, always.
        </p>
      </div>
      <p className="mt-3 text-sm">
        <Link href="/privacy" className="text-accent underline underline-offset-4">
          Read the full privacy policy
        </Link>
      </p>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        <Button type="submit" name="accept_consent" value="1" size="lg" className="w-full">
          Allow AI interpretation
        </Button>
        <Button
          type="submit"
          name="decline_consent"
          value="1"
          variant="secondary"
          size="lg"
          className="w-full"
        >
          Not now — keep the journal without AI
        </Button>
        <div className="flex justify-start">
          <Button type="submit" name="back" value="1" variant="ghost">
            Back
          </Button>
        </div>
      </div>
    </form>
  );
}
