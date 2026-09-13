import Link from 'next/link';
import * as React from 'react';
import type { ReadingCardView, ReadingView } from '@/db/queries/readings';
import { FOLLOW_UP_LABEL, LIFE_AREAS } from '@/domain/readings/types';
import { cn } from '../lib/cn';
import { Card } from './card';
import { LocalTime } from './local-time';
import { SpreadLayout } from './spread-layout';

export interface ReadingDetailSlots {
  /** "Your interpretation" editor (client, bound to the notes action). */
  notes: React.ReactNode;
  /** Earlier versions of the user's own words (invariant 4); null when there are none. */
  history?: React.ReactNode;
  /** Follow-up status control (client). */
  followUp: React.ReactNode;
  /** Post-save "Revisit this?" chip row (client); null when not offered. */
  revisit?: React.ReactNode;
  /** Edit / delete / export controls (client). */
  controls: React.ReactNode;
  /**
   * The AI interpretation (client island that renders the stored layers or streams new ones).
   * When absent the section shows an honest "Not generated." — the reading is complete without it.
   */
  interpretation?: React.ReactNode;
}

export interface ReadingDetailProps {
  reading: ReadingView;
  /** Straight after the save: the first-session line (§6.1) and the revisit offer. */
  justSaved?: boolean;
  slots: ReadingDetailSlots;
  /** Builds the in-app reference link for a card. */
  cardHref?: (card: ReadingCardView) => string;
}

/**
 * Reading detail (§6.3), in order: at a glance · your interpretation · AI interpretation (the
 * stored layers via a slot, or an honest empty state) · cards in position with the deck-native reference meaning
 * · connections (placeholder) · follow-up · controls. Everything on this screen is stored
 * data; nothing is computed by a model when it opens (invariant: opening makes zero AI calls).
 */
export function ReadingDetail({ reading, justSaved = false, slots, cardHref }: ReadingDetailProps) {
  const lifeArea = LIFE_AREAS.find((a) => a.key === reading.life_area)?.label ?? null;
  const title = reading.is_open_reflection ? 'Open reflection' : (reading.question ?? 'Reading');
  return (
    <article data-deck={reading.deck.system} className="pt-4 pb-8">
      {justSaved ? (
        <p role="status" className="mb-4 rounded-card bg-accent-soft px-4 py-3 text-sm">
          This reading is now part of your timeline. If something related happens later, you can
          connect it — or the app can suggest a possible link.
        </p>
      ) : null}

      <header>
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
          <LocalTime iso={reading.occurred_at} />
          <span className="tracking-normal normal-case">
            {' '}
            · {reading.spread.name} · {reading.deck.name} ·{' '}
            {reading.source === 'digital' ? 'digital draw' : 'physical deck'}
          </span>
        </p>
        <h1 className="mt-1 font-serif text-[1.75rem] leading-tight font-medium tracking-tight text-balance">
          {title}
        </h1>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Details">
          {lifeArea ? (
            <li className="rounded-chip bg-surface px-2.5 py-1 text-xs font-medium hairline">
              {lifeArea}
            </li>
          ) : null}
          <li className="rounded-chip bg-surface px-2.5 py-1 text-xs font-medium hairline">
            {FOLLOW_UP_LABEL[reading.follow_up_status]}
          </li>
          {reading.revisit_at ? (
            <li className="rounded-chip bg-surface px-2.5 py-1 text-xs font-medium hairline">
              Revisit <LocalTime iso={reading.revisit_at} dateOnly />
            </li>
          ) : null}
        </ul>
      </header>

      {slots.revisit ? <div className="mt-5">{slots.revisit}</div> : null}

      <section aria-label="Cards" className="mt-6">
        <SpreadLayout
          name={reading.spread.name}
          positions={reading.spread.positions}
          layout={reading.spread.layout}
          legend={false}
          renderSlot={(_pos, index) => {
            const c = reading.cards[index];
            return c ? <Card card={c.card} orientation={c.orientation} size="sm" priority /> : null;
          }}
        />
        <ol className="mt-3 text-sm" aria-label="Cards by position">
          {reading.cards.map((c) => (
            <li key={c.id} className="flex gap-2 py-0.5">
              <span className="w-5 shrink-0 text-right text-fg-muted tabular-nums">
                {c.position_index + 1}
              </span>
              <span>
                <span className="text-fg-muted">{c.position?.name ?? c.position_key}: </span>
                <span className="font-medium">{c.card.name}</span>
                {c.orientation === 'reversed' ? (
                  <span className="text-fg-muted"> · reversed</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="your-interpretation-h" className="mt-8">
        <h2 id="your-interpretation-h" className="mb-2 font-serif text-xl">
          Your interpretation
        </h2>
        {slots.notes}
        {slots.history ? <div className="mt-3">{slots.history}</div> : null}
      </section>

      <section aria-labelledby="ai-interpretation-h" className="mt-8">
        <h2 id="ai-interpretation-h" className="mb-2 font-serif text-xl">
          AI interpretation
        </h2>
        {slots.interpretation ?? (
          <div className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm text-fg-muted">
            <p className="font-medium text-fg">Not generated.</p>
            <p className="mt-1">
              Nothing here was produced by a model. AI interpretation is optional; your reading is
              complete without it.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="cards-h" className="mt-8">
        <h2 id="cards-h" className="mb-1 font-serif text-xl">
          Cards in position
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          Reference meanings in {reading.deck.name}’s own words — nothing generated.
        </p>
        <div className="flex flex-col gap-2">
          {reading.cards.map((c) => (
            <CardInPosition key={c.id} entry={c} href={cardHref?.(c)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="connections-h" className="mt-8">
        <h2 id="connections-h" className="mb-2 font-serif text-xl">
          Connections
        </h2>
        <p className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-sm text-fg-muted">
          Later, life events, journeys and other readings that relate to this one will appear here,
          each with the entries they came from.
        </p>
      </section>

      <section aria-labelledby="follow-up-h" className="mt-8">
        <h2 id="follow-up-h" className="mb-2 font-serif text-xl">
          Follow-up
        </h2>
        {slots.followUp}
      </section>

      <section aria-labelledby="controls-h" className="mt-8">
        <h2 id="controls-h" className="mb-2 font-serif text-xl">
          Controls
        </h2>
        {slots.controls}
      </section>
    </article>
  );
}

function CardInPosition({ entry, href }: { entry: ReadingCardView; href?: string }) {
  const { card, orientation, position } = entry;
  const reversed = orientation === 'reversed';
  const meaning = reversed ? (card.meaning_reversed ?? card.meaning_upright) : card.meaning_upright;
  const keywords =
    reversed && card.keywords_reversed.length ? card.keywords_reversed : card.keywords_upright;
  return (
    <details className="group rounded-card bg-surface hairline">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <Card card={card} orientation={orientation} size="xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-fg-muted">
            {entry.position_index + 1} · {position?.name ?? entry.position_key}
          </span>
          <span className="block truncate text-sm font-medium">
            {card.name}
            {card.title ? (
              <span className="font-normal text-fg-muted italic"> · {card.title}</span>
            ) : null}
            {reversed ? <span className="font-normal text-fg-muted"> · reversed</span> : null}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-fg-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-hairline px-3 py-3 text-sm">
        {position ? <p className="text-fg-muted italic">{position.prompt}</p> : null}
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Keywords">
          {keywords.map((kw) => (
            <li
              key={kw}
              className="rounded-chip bg-accent-soft px-2.5 py-1 text-xs font-medium text-fg"
            >
              {kw}
            </li>
          ))}
        </ul>
        <p className={cn('prose-content mt-3')}>{meaning}</p>
        {reversed && !card.meaning_reversed ? (
          <p className="mt-2 text-xs text-fg-muted">
            {card.deck_name} carries no reversed meaning; the upright text is shown.
          </p>
        ) : null}
        {href ? (
          <Link href={href} className="mt-3 inline-block text-accent underline underline-offset-4">
            Full reference for {card.name}
          </Link>
        ) : null}
      </div>
    </details>
  );
}
