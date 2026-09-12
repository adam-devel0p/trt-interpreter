import * as React from 'react';
import { cn } from '../lib/cn';

export function PageHeader({
  title,
  eyebrow,
  description,
  action,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-end justify-between gap-4 pt-4 pb-5', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-serif text-[1.75rem] leading-tight font-medium tracking-tight">
          {title}
        </h1>
        {description ? <p className="mt-1.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
