'use client';

import { motion } from 'framer-motion';
import * as React from 'react';
import type { CardView, SpreadLayout as Layout, SpreadPosition } from '@/domain/decks/types';
import type { Orientation } from '@/domain/readings/types';
import { useReducedMotion } from '../motion';
import { cn } from '../lib/cn';
import { Card, cardAltText } from './card';
import { SpreadLayout } from './spread-layout';

export interface RevealedCard {
  card: CardView;
  orientation: Orientation;
}

export interface ShuffleRevealProps {
  spreadName: string;
  positions: readonly SpreadPosition[];
  layout: Layout;
  cards: readonly RevealedCard[];
  /** Fires once the cards are all face-up (immediately under reduced motion or after a skip). */
  onDone?: () => void;
  className?: string;
}

const SHUFFLE_MS = 1100;
const REVEAL_STAGGER_MS = 380;

/**
 * The one "delightful" animation (docs/DESIGN_SYSTEM.md): a short shuffle of card backs, then
 * each card turns face-up into its spread position. Skippable by one tap or Enter at any
 * moment; instant under `prefers-reduced-motion`. The cards were already drawn server-side
 * before this mounts — the animation reveals, it never decides (FR-04). Orientation is
 * announced in text as each card lands, never by rotation alone.
 */
export function ShuffleReveal({
  spreadName,
  positions,
  layout,
  cards,
  onDone,
  className,
}: ShuffleRevealProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<'shuffle' | 'reveal' | 'done'>(
    reduced ? 'done' : 'shuffle',
  );
  const [revealed, setRevealed] = React.useState(reduced ? cards.length : 0);
  const doneRef = React.useRef(false);

  const finish = React.useCallback(() => {
    setPhase('done');
    setRevealed(cards.length);
  }, [cards.length]);

  React.useEffect(() => {
    if (phase === 'done' && !doneRef.current) {
      doneRef.current = true;
      onDone?.();
    }
  }, [phase, onDone]);

  React.useEffect(() => {
    if (phase !== 'shuffle') return;
    const t = setTimeout(() => setPhase('reveal'), SHUFFLE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  React.useEffect(() => {
    if (phase !== 'reveal') return;
    if (revealed >= cards.length) {
      setPhase('done');
      return;
    }
    const t = setTimeout(() => setRevealed((n) => n + 1), REVEAL_STAGGER_MS);
    return () => clearTimeout(t);
  }, [phase, revealed, cards.length]);

  const announcement =
    phase === 'shuffle'
      ? 'Shuffling.'
      : cards
          .slice(0, revealed)
          .map(
            (c, i) =>
              `${positions[i]?.name ?? `Position ${i + 1}`}: ${cardAltText(c.card, c.orientation)}.`,
          )
          .join(' ');

  return (
    <div className={cn('relative', className)}>
      {phase === 'shuffle' ? (
        <div
          className="relative mx-auto flex h-48 w-full max-w-xs items-center justify-center"
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              className="absolute w-24"
              initial={{ x: 0, rotate: 0 }}
              animate={{
                x: [0, (i - 2) * 22, (2 - i) * 18, 0],
                rotate: [0, (i - 2) * 6, (2 - i) * 4, 0],
              }}
              transition={{
                duration: SHUFFLE_MS / 1000,
                ease: 'easeInOut',
                times: [0, 0.35, 0.7, 1],
              }}
            >
              <CardBack />
            </motion.div>
          ))}
        </div>
      ) : (
        <SpreadLayout
          name={spreadName}
          positions={positions}
          layout={layout}
          legend={false}
          renderSlot={(_pos, index) => {
            const c = cards[index];
            if (!c) return null;
            if (index >= revealed) return <CardBack />;
            return (
              <motion.div
                className="h-full w-full"
                initial={phase === 'done' && reduced ? false : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
              >
                <Card card={c.card} orientation={c.orientation} size="sm" priority />
              </motion.div>
            );
          }}
        />
      )}

      {phase !== 'done' ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            autoFocus
            onClick={finish}
            className="min-h-11 rounded-control px-4 text-sm font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
          >
            Skip animation
          </button>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

/** A quiet card back in the deck accent: hairline frame, fine lattice, no artwork. */
export function CardBack({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'aspect-[3/5] w-full overflow-hidden rounded-card bg-accent-soft hairline',
        'bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--accent)_6px_7px),repeating-linear-gradient(-45deg,transparent_0_6px,var(--accent)_6px_7px)] opacity-90 bg-blend-multiply',
        className,
      )}
    >
      <div className="m-[8%] h-[84%] rounded-[calc(var(--radius-card)-4px)] border border-accent/60 bg-accent-soft/80" />
    </div>
  );
}
