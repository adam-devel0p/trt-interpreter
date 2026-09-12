import Link from 'next/link';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Privacy' };

/** The full policy, written to be read (§11). Each promise here is backed by a test or a rule. */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-16">
      <header className="py-5">
        <Link href="/" className="font-serif text-lg">
          Tarot Journal
        </Link>
      </header>
      <PageHeader
        title="Privacy"
        description="What we keep, what we send, and what you can do about it."
      />
      <div className="prose-content flex flex-col gap-6 text-fg">
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">Your journal is yours</h2>
          <p>
            Only you can read your readings, notes and events. The database enforces this per row,
            not just the app. Support staff cannot open your entries.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">AI is optional</h2>
          <p>
            If you allow AI interpretation, the cards, your question and the notes for that one
            reading are sent from our server to a model provider to produce an interpretation. Your
            whole history is never sent. Model output is labeled as a suggestion and never rewrites
            your words. You can withdraw consent in Profile at any time; from then on nothing new is
            sent.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">What we log</h2>
          <p>
            Technical logs and error reports carry identifiers and timings, never the text of your
            journal. Analytics, when added, follow the same rule.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">Export and delete</h2>
          <p>
            You can export a complete copy of your journal and delete your account. Deleting removes
            your entries and everything derived from them: interpretations, summaries, links and
            uploaded images.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">Account and sign-in</h2>
          <p>
            Sign-in is handled by a managed authentication service; we never store passwords
            ourselves. Your account identity is kept separate from your journal content.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-sans text-base font-medium">Tarot is reflection</h2>
          <p>
            Interpretations are for reflection and entertainment. For medical, legal, financial or
            safety questions, please turn to qualified help.
          </p>
        </section>
      </div>
    </div>
  );
}
