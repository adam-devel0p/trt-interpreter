'use client';

import * as React from 'react';
import type { PickerCard, SpreadView } from '@/db/queries/decks';
import { Card } from '@/ui/components/card';
import { CardPicker } from '@/ui/components/card-picker';
import { SpreadLayout } from '@/ui/components/spread-layout';

export interface DeckGalleryProps {
  decks: { system: 'rws' | 'thoth'; name: string; cards: PickerCard[] }[];
  spreads: SpreadView[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Phase 02 components in the gallery: Card (art + typographic, sizes, reversed, skeleton),
 * CardPicker (per deck, with a pick log the e2e spec reads) and SpreadLayout.
 */
export function DeckGallery({ decks, spreads }: DeckGalleryProps) {
  const rws = decks.find((d) => d.system === 'rws');
  const thoth = decks.find((d) => d.system === 'thoth');
  const [pickerDeck, setPickerDeck] = React.useState<'rws' | 'thoth'>('rws');
  const [picks, setPicks] = React.useState<PickerCard[]>([]);
  const [slot, setSlot] = React.useState<number | null>(0);
  const active = decks.find((d) => d.system === pickerDeck) ?? decks[0];

  if (!rws || !thoth || !active) {
    return (
      <p className="rounded-card bg-surface p-4 text-sm text-fg-muted hairline">
        Deck reference data is not seeded. Run <code>pnpm db:seed</code>.
      </p>
    );
  }

  const by = (d: typeof rws, slug: string) => d.cards.find((c) => c.slug === slug)!;
  const celtic = spreads.find((s) => s.slug === 'celtic-cross-lite') ?? spreads[0];
  const spreadCards = [
    by(rws, 'the-star'),
    by(rws, 'five-of-pentacles'),
    by(rws, 'the-hermit'),
    null,
    by(rws, 'ace-of-cups'),
  ];

  return (
    <>
      <Section title="Card (Phase 02) — art vs typographic, both first-class">
        <div className="flex flex-wrap items-end gap-4">
          <Card card={by(rws, 'strength')} size="lg" caption />
          <Card card={by(thoth, 'lust')} size="lg" caption />
          <Card card={by(rws, 'the-tower')} size="md" orientation="reversed" caption />
          <Card card={by(thoth, 'two-of-disks')} size="md" caption />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Card card={by(thoth, 'the-aeon')} size="sm" caption />
          <Card card={by(thoth, 'princess-of-disks')} size="sm" caption />
          <Card card={by(rws, 'page-of-pentacles')} size="sm" caption />
          <Card card={by(thoth, 'knight-of-wands')} size="xs" />
          <Card card={by(rws, 'ace-of-swords')} size="xs" />
          <Card card={by(rws, 'the-sun')} size="sm" loading />
        </div>
      </Section>

      <Section title="CardPicker (Phase 02) — ≤ 3 interactions, keyboard-first, deck-scoped">
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Picker deck</legend>
          {decks.map((d) => (
            <button
              key={d.system}
              type="button"
              aria-pressed={pickerDeck === d.system}
              onClick={() => setPickerDeck(d.system)}
              className={
                pickerDeck === d.system
                  ? 'min-h-9 rounded-chip bg-accent px-3 text-sm font-medium text-on-accent'
                  : 'min-h-9 rounded-chip bg-surface px-3 text-sm font-medium text-fg-muted hairline'
              }
            >
              Picker: {d.name}
            </button>
          ))}
        </fieldset>
        <div data-deck={active.system} className="rounded-card bg-bg p-3 hairline">
          <CardPicker
            key={active.system}
            cards={active.cards}
            deckName={active.name}
            recentIds={
              active.system === 'rws' ? [by(rws, 'the-star').id, by(rws, 'ten-of-cups').id] : []
            }
            disabledIds={picks.map((p) => p.id)}
            onPick={(c) => setPicks((p) => [...p, c])}
          />
        </div>
        <ul aria-label="Picked cards" className="flex flex-wrap gap-2 text-sm" data-testid="picked">
          {picks.length === 0 ? (
            <li className="text-fg-muted">Nothing picked yet.</li>
          ) : (
            picks.map((c) => (
              <li key={c.id} className="rounded-chip bg-surface px-2.5 py-1 hairline">
                Picked {c.name} · {c.deck_name}
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title="SpreadLayout (Phase 02) — relative coordinates, 390px-safe">
        {celtic ? (
          <div className="mx-auto max-w-[24rem]">
            <SpreadLayout
              name={celtic.name}
              positions={celtic.positions}
              layout={celtic.layout}
              activeIndex={slot}
              onSelect={setSlot}
              renderSlot={(_p, i) => {
                const c = spreadCards[i];
                return c ? (
                  <Card
                    card={c}
                    size="md"
                    orientation={i === 1 ? 'reversed' : 'upright'}
                    className="w-full"
                  />
                ) : null;
              }}
            />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {spreads
            .filter((s) => s.slug !== 'celtic-cross-lite')
            .map((s) => (
              <div key={s.id} className="rounded-card bg-surface p-3 hairline">
                <SpreadLayout name={s.name} positions={s.positions} layout={s.layout} />
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}
