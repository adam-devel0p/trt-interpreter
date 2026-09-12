'use client';

import * as React from 'react';
import { PREF_IDLE } from '@/auth/form-state';
import {
  setAiConsentAction,
  setDefaultDeckAction,
  setExplanationDepthAction,
  setUseReversalsAction,
} from '@/auth/profile-actions';
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

/** Default deck: native select, saves on change. Options come from the `decks` table. */
export function DeckSelect({
  labelId,
  value,
  decks,
}: {
  labelId: string;
  value: string | null;
  decks: { id: string; name: string }[];
}) {
  const [state, action] = React.useActionState(setDefaultDeckAction, PREF_IDLE);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <select
        name="deck"
        aria-labelledby={labelId}
        defaultValue={value ?? decks[0]?.id}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-11 max-w-[11rem] rounded-control bg-surface px-3 text-base hairline"
      >
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {state.status === 'error' ? <FormMessage tone="error">{state.message}</FormMessage> : null}
    </form>
  );
}

/** Reversals switch: optimistic, reverted with a message if the write fails. */
export function ReversalsToggle({ labelId, enabled }: { labelId: string; enabled: boolean }) {
  const [checked, setChecked] = React.useState(enabled);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const onChange = (next: boolean) => {
    setChecked(next);
    setError(null);
    start(async () => {
      const res = await setUseReversalsAction(next);
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
