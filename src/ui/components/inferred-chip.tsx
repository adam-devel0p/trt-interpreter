'use client';

import { Popover } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * The visual contract for model-derived metadata (docs/DESIGN_SYSTEM.md → "Inferred is always
 * labeled"): the word "suggested", a distinct dashed treatment, one-tap correct/dismiss, and a
 * "why?" disclosure that lists the actual reasons. Meaning is never carried by colour alone.
 */
export function InferredChip({
  children,
  reasons = [],
  onCorrect,
  onDismiss,
  className,
}: {
  children: React.ReactNode;
  reasons?: readonly string[];
  onCorrect?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-chip border border-dashed border-hairline-strong bg-surface-ai py-1 pr-1 pl-2.5 text-xs',
        className,
      )}
    >
      <span className="text-fg-muted">suggested</span>
      <span className="truncate font-medium">{children}</span>
      {reasons.length > 0 ? (
        <Popover.Root>
          <Popover.Trigger
            className="min-h-7 rounded-chip px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Why am I seeing this?"
          >
            why?
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={6}
              className="z-50 w-72 rounded-card bg-surface p-3 text-sm hairline"
            >
              <p className="mb-1.5 text-xs font-medium text-fg-muted uppercase">
                Why this was suggested
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <Popover.Arrow className="fill-surface" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
      {onCorrect ? (
        <button
          type="button"
          onClick={onCorrect}
          className="min-h-7 rounded-chip px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          correct
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="min-h-7 min-w-7 rounded-chip px-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
