'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { DeckRow, PickerCard, SpreadView } from '@/db/queries/decks';
import type { ReadingView } from '@/db/queries/readings';
import type { DraftCard } from '@/domain/readings/draft';
import { LIFE_AREAS, QUESTION_MAX, type LifeAreaKey } from '@/domain/readings/types';
import { Button } from '@/ui/components/button';
import { CardEntry } from '@/ui/components/card-entry';
import { FormMessage } from '@/ui/components/field';
import { updateReadingAction } from '../../actions';

export function EditReadingForm({
  reading,
  decks,
  spreads,
  cardsByDeck,
  recentIds,
  hasInterpretation,
}: {
  reading: ReadingView;
  decks: DeckRow[];
  spreads: SpreadView[];
  cardsByDeck: Record<string, PickerCard[]>;
  recentIds: string[];
  hasInterpretation: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = React.useState(reading.question ?? '');
  const [open, setOpen] = React.useState(reading.is_open_reflection);
  const [lifeArea, setLifeArea] = React.useState<LifeAreaKey | ''>(
    (reading.life_area as LifeAreaKey | null) ?? '',
  );
  const [occurredAt, setOccurredAt] = React.useState(toLocalInput(reading.occurred_at));
  const [deckId, setDeckId] = React.useState(reading.deck.id);
  const [spreadId, setSpreadId] = React.useState(reading.spread.id);
  const [usesReversals, setUsesReversals] = React.useState(reading.uses_reversals);
  const [placed, setPlaced] = React.useState<(DraftCard | null)[]>(
    reading.spread.positions.map((_, i) => {
      const c = reading.cards[i];
      return c ? { card_id: c.card.id, orientation: c.orientation } : null;
    }),
  );
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const deck = decks.find((d) => d.id === deckId) ?? reading.deck;
  const spread = spreads.find((s) => s.id === spreadId) ?? reading.spread;
  const cards = cardsByDeck[deck.id] ?? [];
  const structureChanged = deck.id !== reading.deck.id || spread.id !== reading.spread.id;
  const complete = placed.every((c) => c !== null) && (open || question.trim().length > 0);

  /** A deck change invalidates every card (a card belongs to one deck): clear, never guess. */
  const chooseDeck = (id: string) => {
    if (id === deckId) return;
    const next = decks.find((d) => d.id === id);
    if (!next) return;
    setDeckId(id);
    setUsesReversals(next.supports_reversals && usesReversals);
    setPlaced(spread.positions.map(() => null));
  };

  /** A spread change keeps the cards that still have a position and adds empty slots. */
  const chooseSpread = (id: string) => {
    if (id === spreadId) return;
    const next = spreads.find((s) => s.id === id);
    if (!next) return;
    setSpreadId(id);
    setPlaced(next.positions.map((_, i) => placed[i] ?? null));
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await updateReadingAction(
        reading.id,
        {
          question: open ? null : question.trim() || null,
          is_open_reflection: open,
          life_area: lifeArea || null,
          occurred_at: new Date(occurredAt).toISOString(),
        },
        placed.map((c, position_index) => ({
          position_index,
          card_id: c!.card_id,
          orientation: usesReversals ? c!.orientation : 'upright',
        })),
        {
          ...(spread.id !== reading.spread.id ? { spread_id: spread.id } : {}),
          ...(deck.id !== reading.deck.id ? { deck_id: deck.id } : {}),
          ...(usesReversals !== reading.uses_reversals ? { uses_reversals: usesReversals } : {}),
        },
      );
      if (!res.ok) setError(res.message);
      else router.push(`/reading/${reading.id}`);
    });
  };

  return (
    <form
      data-deck={deck.system}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !pending) submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-question" className="text-sm font-medium">
          Question
        </label>
        <textarea
          id="edit-question"
          value={question}
          rows={2}
          maxLength={QUESTION_MAX}
          disabled={open}
          onChange={(e) => setQuestion(e.target.value)}
          className="prose-content w-full rounded-control bg-surface px-3 py-2 text-fg hairline disabled:opacity-60"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
            className="size-4"
          />
          Open reflection (no question)
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-life-area" className="text-sm font-medium">
          Life area
        </label>
        <select
          id="edit-life-area"
          value={lifeArea}
          onChange={(e) => setLifeArea(e.target.value as LifeAreaKey | '')}
          className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
        >
          <option value="">None</option>
          {LIFE_AREAS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-occurred-at" className="text-sm font-medium">
          When
        </label>
        <input
          id="edit-occurred-at"
          type="datetime-local"
          value={occurredAt}
          max={toLocalInput(new Date().toISOString())}
          required
          onChange={(e) => setOccurredAt(e.target.value)}
          className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-deck" className="text-sm font-medium">
            Deck
          </label>
          <select
            id="edit-deck"
            value={deckId}
            onChange={(e) => chooseDeck(e.target.value)}
            className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-spread" className="text-sm font-medium">
            Spread
          </label>
          <select
            id="edit-spread"
            value={spreadId}
            onChange={(e) => chooseSpread(e.target.value)}
            className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
          >
            {spreads.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.card_count}
              </option>
            ))}
          </select>
        </div>
      </div>
      {deck.supports_reversals ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={usesReversals}
            onChange={(e) => setUsesReversals(e.target.checked)}
            className="size-4"
          />
          This reading uses reversals
        </label>
      ) : (
        <p className="text-sm text-fg-muted">{deck.name} never uses reversals.</p>
      )}
      {structureChanged ? (
        <p role="status" className="rounded-card bg-accent-soft px-4 py-3 text-sm">
          {deck.id !== reading.deck.id
            ? `Switching to ${deck.name} cleared the cards — a card belongs to one deck. Enter them again below.`
            : `The spread is now ${spread.name}; fill any new positions below.`}
          {hasInterpretation
            ? ' The stored AI interpretation will be marked as for the earlier cards; you can regenerate it or leave it.'
            : ''}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Cards</legend>
        <CardEntry
          spreadName={spread.name}
          positions={spread.positions}
          layout={spread.layout}
          cards={cards}
          deckName={deck.name}
          recentIds={deck.id === reading.deck.id ? recentIds : []}
          placed={placed}
          usesReversals={usesReversals}
          onPlace={(i, id) =>
            setPlaced((p) =>
              p.some((c, k) => c?.card_id === id && k !== i)
                ? p
                : p.map((c, k) => (k === i ? { card_id: id, orientation: 'upright' } : c)),
            )
          }
          onRemove={(i) => setPlaced((p) => p.map((c, k) => (k === i ? null : c)))}
          onToggle={(i) =>
            setPlaced((p) =>
              p.map((c, k) =>
                k === i && c
                  ? { ...c, orientation: c.orientation === 'upright' ? 'reversed' : 'upright' }
                  : c,
              ),
            )
          }
          onSwap={(a, b) =>
            setPlaced((p) => {
              if (a < 0 || b < 0 || a >= p.length || b >= p.length) return p;
              const next = p.slice();
              const t = next[a] ?? null;
              next[a] = next[b] ?? null;
              next[b] = t;
              return next;
            })
          }
        />
      </fieldset>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href={`/reading/${reading.id}`}>Cancel</Link>
        </Button>
        <Button type="submit" size="lg" disabled={!complete || pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
