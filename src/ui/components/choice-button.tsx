import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * One large tappable option that submits the form it sits in (name/value carry the choice), so
 * an onboarding step is a single thumb-reach action and a single Enter for keyboard users.
 */
export function ChoiceButton({
  title,
  description,
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  description?: string;
  selected?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-pressed={selected}
      className={cn(
        'flex min-h-14 w-full flex-col items-start gap-0.5 rounded-card bg-surface px-4 py-3 text-left hairline transition-colors hover:bg-surface-2',
        selected && 'ring-2 ring-accent',
        className,
      )}
      {...props}
    >
      <span className="text-base font-medium">{title}</span>
      {description ? <span className="text-sm text-fg-muted">{description}</span> : null}
    </button>
  );
}
