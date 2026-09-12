import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

/**
 * Honest and recoverable. Copy order: what happened → what is safe → what to do next.
 * Example: "Interpretation unavailable — your reading is saved. Retry?"
 */
export function ErrorState({
  title,
  safe,
  onRetry,
  retryLabel = 'Retry',
  className,
}: {
  title: string;
  /** What is safe / not lost. Always present: content loss is never an acceptable failure. */
  safe: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('rounded-card border border-danger/40 bg-danger-soft/40 px-4 py-4', className)}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-fg-muted">{safe}</p>
      {onRetry ? (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
