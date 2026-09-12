'use client';

import Link from 'next/link';
import * as React from 'react';
import { BottomNav } from '@/ui/components/bottom-nav';
import { Button } from '@/ui/components/button';
import { ConfidenceBadge } from '@/ui/components/confidence-badge';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { EmptyState } from '@/ui/components/empty-state';
import { ErrorState } from '@/ui/components/error-state';
import { InferredChip } from '@/ui/components/inferred-chip';
import { PageHeader } from '@/ui/components/page-header';
import { ChoiceButton } from '@/ui/components/choice-button';
import { Field, FormMessage } from '@/ui/components/field';
import { SettingsRow, SettingsSection } from '@/ui/components/settings';
import { Switch } from '@/ui/components/switch';
import { Skeleton, SkeletonCard } from '@/ui/components/skeleton';

type Theme = 'system' | 'light' | 'dark';
type Deck = 'rws' | 'thoth';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Gallery({ deckSections }: { deckSections?: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>('system');
  const [deck, setDeck] = React.useState<Deck>('rws');
  const [log, setLog] = React.useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 5));

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.setAttribute('data-deck', deck);
  }, [theme, deck]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap gap-4 rounded-card bg-surface p-3 hairline">
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Theme</legend>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={theme === t ? 'primary' : 'secondary'}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              {t}
            </Button>
          ))}
        </fieldset>
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Deck accent</legend>
          {(['rws', 'thoth'] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={deck === d ? 'primary' : 'secondary'}
              aria-pressed={deck === d}
              onClick={() => setDeck(d)}
            >
              {d === 'rws' ? 'RWS' : 'Thoth'}
            </Button>
          ))}
        </fieldset>
      </div>

      <Section title="Type">
        <p className="prose-content">
          Content serif: The Three of Swords in the position of what surrounds you may point to a
          hurt that has already been named rather than one still coming.
        </p>
        <p className="text-sm text-fg-muted">UI sans, muted: labels, chrome, timestamps, counts.</p>
      </Section>

      <Section title="PageHeader">
        <div className="rounded-card bg-surface px-4 hairline">
          <PageHeader
            eyebrow="Tuesday, 3 September"
            title="Should I take the Berlin offer?"
            description="Three cards · Thoth · physical deck"
            action={
              <Button size="sm" variant="secondary">
                Edit
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="User text vs AI text">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Your interpretation</p>
            <p className="prose-content">
              I keep drawing the Tower when I think about this move. It doesn&apos;t feel like a
              warning so much as an admission that I&apos;ve already decided.
            </p>
          </div>
          <div className="rounded-card border-l-2 border-accent bg-surface-ai px-4 py-3">
            <p className="mb-1 text-xs font-medium text-fg-muted">AI interpretation</p>
            <p className="text-sm">
              One way to read this spread is as a decision that has already been made underneath the
              question. The Tower here suggests disruption you are choosing, not suffering.
            </p>
          </div>
        </div>
      </Section>

      <Section title="InferredChip">
        <div className="flex flex-wrap gap-2">
          <InferredChip
            reasons={['Mentioned "the offer" in two readings this month', 'Same life area: work']}
            onCorrect={() => note('correct: journey')}
            onDismiss={() => note('dismiss: journey')}
          >
            Journey: Berlin decision
          </InferredChip>
          <InferredChip reasons={['Entity alias “M.” resolved with moderate confidence']}>
            Person: Maya
          </InferredChip>
          <InferredChip onDismiss={() => note('dismiss: theme')}>Theme: endings</InferredChip>
        </div>
      </Section>

      <Section title="ConfidenceBadge">
        <div className="flex flex-wrap gap-2">
          <ConfidenceBadge score={0.42} />
          <ConfidenceBadge score={0.71} />
          <ConfidenceBadge score={0.91} />
        </div>
      </Section>

      <Section title="Skeleton">
        <SkeletonCard />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 flex-1" />
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          title="Your readings will collect here"
          description="The first one is the start of your timeline."
          action={<Button>New reading</Button>}
        />
      </Section>

      <Section title="ErrorState">
        <ErrorState
          title="Interpretation unavailable"
          safe="Your reading is saved. Nothing you wrote is lost."
          onRetry={() => note('retry')}
        />
      </Section>

      <Section title="ConfirmDestructive">
        <ConfirmDestructive
          trigger={<Button variant="destructive">Delete this reading</Button>}
          title="Delete this reading?"
          description="The reading, your notes and every AI artifact derived from it will be removed. This cannot be undone."
          confirmLabel="Delete reading"
          onConfirm={() => note('confirmed delete')}
        />
      </Section>

      <Section title="Field / FormMessage (Phase 01)">
        <form className="flex max-w-sm flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <Field id="g-email" name="email" type="email" label="Email" hint="We never share it." />
          <Field
            id="g-password"
            name="password"
            type="password"
            label="Password"
            error="Use at least 8 characters."
          />
          <FormMessage tone="error">That email and password don&apos;t match.</FormMessage>
          <FormMessage tone="info">
            If that address can receive mail from us, a link is on its way.
          </FormMessage>
        </form>
      </Section>

      <Section title="ChoiceButton (Phase 01)">
        <form className="flex max-w-sm flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
          <ChoiceButton title="I draw digitally" description="Shuffle and draw in the app." />
          <ChoiceButton
            title="I use my own deck"
            description="Log the cards you drew by hand."
            selected
          />
          <ChoiceButton title="Both" />
        </form>
      </Section>

      <Section title="Settings / Switch (Phase 01)">
        <SettingsSection title="AI & privacy">
          <SettingsRow
            label="AI interpretation"
            labelId="g-consent"
            description="On. Readings can be sent to a model for interpretation."
            control={<Switch aria-labelledby="g-consent" defaultChecked />}
          />
          <SettingsRow
            label="Delete AI artifacts"
            description="Keep your own words."
            comingIn="Phase 05"
          />
        </SettingsSection>
      </Section>

      {deckSections}

      <Section title="BottomNav (static preview)">
        <div className="relative h-16 overflow-hidden rounded-card">
          <div className="absolute inset-0 [&>nav]:absolute [&>nav]:inset-x-0 [&>nav]:bottom-0">
            <BottomNav />
          </div>
        </div>
      </Section>

      <Section title="Event log">
        <ul className="text-xs text-fg-muted" aria-live="polite">
          {log.length === 0 ? (
            <li>No interactions yet.</li>
          ) : (
            log.map((l, i) => <li key={i}>{l}</li>)
          )}
        </ul>
      </Section>

      <p className="text-xs text-fg-muted">
        Also see{' '}
        <Link href="/dev/flags" className="underline">
          /dev/flags
        </Link>
        .
      </p>
    </div>
  );
}
