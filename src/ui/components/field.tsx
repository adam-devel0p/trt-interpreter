import * as React from 'react';
import { cn } from '../lib/cn';

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  /** Short helper under the label; hidden when an error is shown. */
  hint?: string;
  /** Rendered in an alert region and linked via aria-describedby. */
  error?: string;
}

/**
 * Label + input + error, wired for assistive tech: the label is a real <label>, the error is
 * announced (role="alert") and referenced by aria-describedby, aria-invalid flips with it.
 * Inputs are 44px tall and 16px text so iOS does not zoom on focus.
 */
export function Field({ id, label, hint, error, className, ...input }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'min-h-11 w-full rounded-control bg-surface px-3 text-base text-fg hairline placeholder:text-fg-faint',
          error && 'ring-2 ring-danger',
        )}
        {...input}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level message. `tone="error"` is announced assertively; `info` politely. */
export function FormMessage({
  tone,
  children,
  className,
}: {
  tone: 'error' | 'info';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-control px-3 py-2 text-sm',
        tone === 'error' ? 'bg-danger-soft text-fg' : 'bg-surface-2 text-fg',
        className,
      )}
    >
      {children}
    </p>
  );
}
