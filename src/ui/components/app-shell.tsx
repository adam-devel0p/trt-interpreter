import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Single centred column (max ~720px), bottom-nav-safe padding, semantic landmarks.
 * Pages render inside <main>; navigation is passed in so the shell stays server-renderable.
 */
export function AppShell({
  children,
  nav,
  className,
}: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-dvh flex-col bg-bg text-fg', className)}>
      <a
        href="#main"
        className="sr-only rounded-control bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <main
        id="main"
        className={cn('mx-auto w-full max-w-[720px] flex-1 px-4 pt-3', nav ? 'pb-24' : 'pb-8')}
      >
        {children}
      </main>
      {nav}
    </div>
  );
}
