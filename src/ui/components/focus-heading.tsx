'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * A page/step heading that receives focus when it mounts. Used on multi-step flows so that
 * advancing a step moves the screen reader and keyboard user to the new content instead of
 * leaving them on a button that no longer exists. `key` the component by step to re-mount.
 */
export function FocusHeading({
  children,
  className,
  as: Tag = 'h1',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'h1' | 'h2';
}) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, []);
  return (
    <Tag
      ref={ref}
      tabIndex={-1}
      className={cn(
        'font-serif text-[1.75rem] leading-tight font-medium tracking-tight outline-none',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
