'use client';

import { Dialog } from 'radix-ui';
import * as React from 'react';
import { Button } from './button';
import { cn } from '../lib/cn';

/**
 * The paywall (spec §14, §4.8, DESIGN_SYSTEM). Appears only at the point of a premium action
 * and says what that action would do with *this* journal; annual first with a monthly
 * option; the trial's end date is stated in plain text; cancellation is named as one tap;
 * and the line about the archive is on every variant, because invariant 11 is a promise
 * worth repeating. No countdowns, no scarcity, no guilt. Price and terms are real text.
 */
export interface OfferView {
  feature: string;
  reason: 'plan' | 'monthly' | 'daily' | null;
  used: number;
  limit: number | null;
  lines: { interval: 'month' | 'year'; amount: string; perMonth: string; note: string | null }[];
  trialDays: number;
  trialAvailable: boolean;
  status: string | null;
}

export interface PremiumOfferProps {
  offer: OfferView;
  /** The value sentence for this context: "Ask My History searches all 84 of your readings." */
  context: string;
  /** What still works without paying — always stated (§4.8). */
  stillWorks: string;
  /** Path to return to after checkout. */
  returnTo: string;
  /** Server action: `startCheckoutAction`. */
  action: (formData: FormData) => Promise<void>;
  /** Server action to record the view (`notePaywallViewedAction`); called once when visible. */
  onViewed?: (feature: string, reason: string) => void | Promise<void>;
  onDismiss?: () => void;
  /** Heading level for the title; the sheet uses Dialog.Title, the card an h2. */
  as?: 'sheet' | 'card';
}

const PREMIUM_ADDS = [
  'Ask my history — questions answered from your own entries, with sources',
  'Monthly and journey summaries, each claim traced to what you wrote',
  'The reasoning behind a suggested connection between a reading and a life event',
  'Up to 300 interpretations a month, on the deeper model',
];

function trialEndLabel(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function PremiumOffer(props: PremiumOfferProps) {
  const { offer, context, stillWorks, returnTo, action, onViewed, onDismiss, as = 'card' } = props;
  const [interval, setInterval] = React.useState<'month' | 'year'>('year');
  const viewed = React.useRef(false);
  React.useEffect(() => {
    if (!viewed.current) {
      viewed.current = true;
      void onViewed?.(offer.feature, offer.reason ?? 'plan');
    }
  }, [onViewed, offer.feature, offer.reason]);
  const paused = offer.status === 'past_due' || offer.status === 'unpaid';
  const Title = as === 'sheet' ? Dialog.Title : 'h2';
  const Description = as === 'sheet' ? Dialog.Description : 'p';
  const trialEnd = offer.trialAvailable ? trialEndLabel(offer.trialDays) : null;
  const cta = paused
    ? 'Update payment details'
    : offer.trialAvailable
      ? `Start ${offer.trialDays} days free`
      : interval === 'year'
        ? 'Subscribe for a year'
        : 'Subscribe monthly';

  return (
    <div data-paywall={offer.feature} className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Premium</p>
        <Title className="mt-1 font-serif text-xl leading-snug">{context}</Title>
        <Description className="mt-2 text-sm text-fg-muted">
          {paused
            ? 'Premium is paused because the last payment did not go through. Everything you wrote is here; new analysis waits until billing is sorted.'
            : offer.reason === 'monthly'
              ? `Free includes ${offer.limit} a month; you have used ${offer.used}. The count starts again on the first of next month.`
              : offer.reason === 'daily'
                ? 'You have reached today’s limit. It resets at midnight UTC.'
                : 'Premium is the analysis on top of your journal. The journal itself stays free.'}
        </Description>
      </div>

      {!paused ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {PREMIUM_ADDS.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-accent">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="return" value={returnTo} />
        {!paused ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Billing period</legend>
            {offer.lines.map((line) => {
              const checked = interval === line.interval;
              return (
                <label
                  key={line.interval}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2.5 hairline',
                    checked ? 'bg-accent-soft outline-2 outline-accent' : 'bg-surface',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="interval"
                      value={line.interval}
                      checked={checked}
                      onChange={() => setInterval(line.interval)}
                      className="size-4 accent-accent"
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{line.amount}</span>
                      <span className="text-xs text-fg-muted">{line.perMonth}</span>
                    </span>
                  </span>
                  {line.note ? (
                    <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                      {line.note}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <input type="hidden" name="interval" value="year" />
        )}

        <p className="text-xs leading-relaxed text-fg-muted">
          {trialEnd
            ? `Free until ${trialEnd}. Nothing is charged before then; the date is shown in Profile and you can cancel there in one tap. `
            : paused
              ? ''
              : 'Cancel any time from Profile, in one tap. '}
          {stillWorks}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onDismiss ? (
            <Button type="button" variant="secondary" onClick={onDismiss}>
              Not now
            </Button>
          ) : null}
          <Button type="submit" variant="primary">
            {cta}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The inline variant: takes the place of the premium control it stands in for. */
export function PaywallCard(props: Omit<PremiumOfferProps, 'as' | 'onDismiss'>) {
  return (
    <section
      aria-label="Premium"
      className="rounded-card bg-surface p-4 hairline"
      data-testid="paywall-card"
    >
      <PremiumOffer {...props} as="card" />
    </section>
  );
}

/**
 * The sheet variant (a Radix Dialog: focus-trapped, Escape closes, labelled by its title).
 * Opened by a control at the premium action — never on page load.
 */
export function PaywallSheet(
  props: Omit<PremiumOfferProps, 'as' | 'onDismiss'> & { trigger: React.ReactNode },
) {
  const { trigger, ...offer } = props;
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-5 shadow-none hairline"
          data-testid="paywall-sheet"
        >
          {open ? <PremiumOffer {...offer} as="sheet" onDismiss={() => setOpen(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
