'use client';

import * as React from 'react';
import { FormMessage } from '@/ui/components/field';
import { Switch } from '@/ui/components/switch';
import { setRetentionSettingAction } from './actions';

/** One resurfacing switch: optimistic flip, reverted with a message if the write fails. */
export function RetentionToggle({
  labelId,
  settingKey,
  enabled,
}: {
  labelId: string;
  settingKey: string;
  enabled: boolean;
}) {
  const [checked, setChecked] = React.useState(enabled);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const onChange = (next: boolean) => {
    setChecked(next);
    setError(null);
    start(async () => {
      const res = await setRetentionSettingAction(settingKey, next);
      if (!res.ok) {
        setChecked(!next);
        setError(res.message);
      }
    });
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={onChange}
        disabled={pending}
        data-testid={`retention-${settingKey}`}
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
