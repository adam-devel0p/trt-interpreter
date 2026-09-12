import * as React from 'react';
import type { SpreadLayout as Layout, SpreadPosition } from '@/domain/decks/types';
import { cn } from '../lib/cn';

export interface SpreadLayoutProps {
  name: string;
  positions: readonly SpreadPosition[];
  layout: Layout;
  /** What to render in each slot (a `Card`, or nothing for an empty slot). */
  renderSlot?: (position: SpreadPosition, index: number) => React.ReactNode;
  /** When set, slots are buttons and the active one is highlighted. */
  activeIndex?: number | null;
  onSelect?: (index: number) => void;
  /** Show the numbered legend of position names under the canvas (default true). */
  legend?: boolean;
  className?: string;
}

/** Card aspect used to derive slot heights from the relative width (3:5). */
const CARD_ASPECT = 0.6;

/**
 * Renders spread positions from relative layout coordinates so the same data scales from
 * 390px to desktop. Every slot carries a visible number; the legend beneath maps numbers to
 * position names so names are always readable, even for the crossing card of a Celtic cross.
 */
export function SpreadLayout({
  name,
  positions,
  layout,
  renderSlot,
  activeIndex = null,
  onSelect,
  legend = true,
  className,
}: SpreadLayoutProps) {
  const id = React.useId();
  return (
    <div className={cn('w-full', className)}>
      <div
        role="group"
        aria-label={`${name} layout`}
        className="relative w-full"
        style={{ aspectRatio: String(layout.aspect) }}
      >
        {layout.slots.map((slot) => {
          const pos = positions[slot.index];
          if (!pos) return null;
          const h = (slot.w * layout.aspect) / CARD_ASPECT;
          const style: React.CSSProperties = {
            left: `${(slot.x - slot.w / 2) * 100}%`,
            top: `${(slot.y - h / 2) * 100}%`,
            width: `${slot.w * 100}%`,
            height: `${h * 100}%`,
            transform: slot.rotate ? `rotate(${slot.rotate}deg)` : undefined,
            zIndex: slot.rotate ? 2 : 1,
          };
          const content = renderSlot?.(pos, slot.index);
          const isActive = activeIndex === slot.index;
          const inner = (
            <>
              <span
                className={cn(
                  'absolute -top-2 -left-2 z-10 flex size-5 items-center justify-center rounded-full text-[0.625rem] font-medium tabular-nums hairline',
                  isActive ? 'bg-accent text-on-accent' : 'bg-surface text-fg',
                )}
                style={slot.rotate ? { transform: `rotate(${-slot.rotate}deg)` } : undefined}
                aria-hidden="true"
              >
                {slot.index + 1}
              </span>
              {content ?? (
                <span className="flex h-full w-full items-center justify-center rounded-card border border-dashed border-hairline-strong bg-surface/60 p-1 text-center text-[0.625rem] leading-tight text-fg-muted">
                  {pos.name}
                </span>
              )}
            </>
          );
          const common = {
            className: cn(
              'absolute [&_figure]:w-full [&_figure_img]:h-full',
              isActive && 'rounded-card outline-2 outline-offset-2 outline-accent',
            ),
            style,
          };
          return onSelect ? (
            <button
              key={slot.index}
              type="button"
              aria-label={`Position ${slot.index + 1}: ${pos.name}`}
              aria-pressed={isActive}
              aria-describedby={`${id}-legend-${slot.index}`}
              onClick={() => onSelect(slot.index)}
              {...common}
            >
              {inner}
            </button>
          ) : (
            <div
              key={slot.index}
              aria-label={`Position ${slot.index + 1}: ${pos.name}`}
              role="group"
              {...common}
            >
              {inner}
            </div>
          );
        })}
      </div>
      {legend ? (
        <ol className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {positions.map((p) => (
            <li key={p.key} id={`${id}-legend-${p.index}`} className="flex gap-2">
              <span className="w-5 shrink-0 text-right font-medium text-fg-muted tabular-nums">
                {p.index + 1}
              </span>
              <span className={cn(activeIndex === p.index && 'font-medium text-accent')}>
                {p.name}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
