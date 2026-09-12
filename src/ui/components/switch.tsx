'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/cn';

/** Accessible toggle (role="switch"). Always pair with a visible label via `aria-labelledby`. */
export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-chip bg-hairline-strong transition-colors disabled:opacity-50 data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-1 rounded-chip bg-surface shadow transition-transform data-[state=checked]:translate-x-6" />
    </RadixSwitch.Root>
  );
}
