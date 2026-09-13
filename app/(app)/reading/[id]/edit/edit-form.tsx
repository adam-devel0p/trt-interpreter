'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { PickerCard } from '@/db/queries/decks';
import type { ReadingView } from '@/db/queries/readings';
import type { DraftCard } from '@/domain/readings/draft';
import { LIFE_AREAS, QUESTION_MAX, type LifeAreaKey } from '@/domain/readings/types';
import { Button } from '@/ui/components/button';
import { CardEntry } from '@/ui/components/card-entry';
import { FormMessage } from '@/ui/components/field';
import { updateReadingAction } from '../../actions';

export function EditReadingForm({
  reading,
  cards,
  recentIds,
}: {
  reading: ReadingView;
  cards: PickerCard[];
  recentIds: string[];
}) {
  const router = useRouter();
  const [question, setQuestion] = React.useState(reading.question ?? '');
  const [open, setOpen] = React.useState(reading.is_open_reflection);
  const [lifeArea, setLifeArea] = React.useState<LifeAreaKey | ''>(
    (reading.life_area as LifeAreaKey | null) ?? '',
  );
  const [occurredAt, setOccurredAt] = React.useState(toLocalInput(reading.occurred_at));
  const [placed, setPlaced] = React.useState<(DraftCard | null)[]>(
    reading.spread.positions.map((_, i) => {
      const c = reading.cards[i];
      return c ? { card_id: c.card.id, orientation: c.orientation } : null;
    }),
  );
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const complete = placed.every((c) => c !== null) && (open || question.trim().length > 0);

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
          orientation: c!.orientation,
        })),
      );
      if (!res.ok) setError(res.message);
      else router.push(`/reading/${reading.id}`);
    });
  };

  return (
    <form
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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Cards</legend>
        <CardEntry
          spreadName={reading.spread.name}
          positions={reading.spread.positions}
          layout={reading.spread.layout}
          cards={cards}
          deckName={reading.deck.name}
          recentIds={recentIds}
          placed={placed}
          usesReversals={reading.uses_reversals}
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
