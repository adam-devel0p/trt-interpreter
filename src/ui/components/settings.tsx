import * as React from 'react';
import { cn } from '../lib/cn';

/** A titled group of settings rows. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('mb-8', className)}>
      <h2 id={id} className="mb-1 font-serif text-xl">
        {title}
      </h2>
      {description ? <p className="mb-3 text-sm text-fg-muted">{description}</p> : null}
      <div className="divide-y divide-hairline rounded-card bg-surface hairline">{children}</div>
    </section>
  );
}

/**
 * Label + description on the left, control on the right. When `comingIn` is set the row is
 * a labeled placeholder: it says which phase brings it and never looks broken.
 */
export function SettingsRow({
  label,
  description,
  labelId,
  control,
  comingIn,
}: {
  label: string;
  description?: string;
  /** Pass to link a control's aria-labelledby. */
  labelId?: string;
  control?: React.ReactNode;
  comingIn?: string;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={labelId} className={cn('text-sm font-medium', comingIn && 'text-fg-muted')}>
          {label}
        </p>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {comingIn ? (
        <span className="shrink-0 rounded-chip bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted">
          {comingIn}
        </span>
      ) : (
        <div className="shrink-0">{control}</div>
      )}
    </div>
  );
}
