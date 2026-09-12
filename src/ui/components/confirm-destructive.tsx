'use client';

import { AlertDialog } from 'radix-ui';
import * as React from 'react';
import { Button } from './button';

/**
 * The one legitimate modal: destructive confirmation (docs/DESIGN_SYSTEM.md). Radix supplies
 * focus trap, Escape, and ARIA. Copy is plain and specific; the destructive verb is the button.
 */
export function ConfirmDestructive({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-fg/40 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface p-5 shadow-none hairline">
          <AlertDialog.Title className="font-serif text-xl">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Keep it</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await onConfirm();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
