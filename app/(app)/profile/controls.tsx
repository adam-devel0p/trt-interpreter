'use client';

import * as React from 'react';
import { PREF_IDLE } from '@/auth/form-state';
import { setAiConsentAction, setExplanationDepthAction } from '@/auth/profile-actions';
import { EXPLANATION_DEPTHS, type ExplanationDepth } from '@/db/queries/profile';
import { FormMessage } from '@/ui/components/field';
import { Switch } from '@/ui/components/switch';

/** Consent switch: optimistic flip, reverted with a message if the write fails. */
export function ConsentToggle({ labelId, granted }: { labelId: string; granted: boolean }) {
  const [checked, setChecked] = React.useState(granted);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const onChange = (next: boolean) => {
    setChecked(next);
    setError(null);
    start(async () => {
      const res = await setAiConsentAction(next);
      if (res.status === 'error') {
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
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

const DEPTH_LABEL: Record<ExplanationDepth, string> = {
  brief: 'Brief',
  standard: 'Standard',
  deep: 'In depth',
};

/** Native select that saves on change; no separate save button to hunt for. */
export function DepthSelect({ labelId, value }: { labelId: string; value: ExplanationDepth }) {
  const [state, action] = React.useActionState(setExplanationDepthAction, PREF_IDLE);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <select
        name="depth"
        aria-labelledby={labelId}
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
      >
        {EXPLANATION_DEPTHS.map((d) => (
          <option key={d} value={d}>
            {DEPTH_LABEL[d]}
          </option>
        ))}
      </select>
      {state.status === 'error' ? <FormMessage tone="error">{state.message}</FormMessage> : null}
    </form>
  );
}
