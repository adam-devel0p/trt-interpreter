import * as React from 'react';
import { cn } from '../lib/cn';

/** Teaches the next useful action in one sentence. Never a shrug. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-dashed border-hairline-strong px-5 py-10 text-center',
        className,
      )}
      aria-labelledby={undefined}
    >
      <h2 className="font-serif text-xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-fg-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}
