'use client';

import * as React from 'react';
import { FormMessage } from '@/ui/components/field';
import { Switch } from '@/ui/components/switch';
import { Button } from '@/ui/components/button';
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  updateReminderPrefsAction,
} from './reminder-actions';

/**
 * Reminder delivery controls (§15.2, §4.7). A channel (none / email / push with email as
 * the fallback), three switches — each a specific, content-anchored reminder — and quiet
 * hours. No streaks, no "daily reminder", no default nudging: the channel starts at none.
 */
export function ReminderChannelSelect({
  labelId,
  value,
}: {
  labelId: string;
  value: 'push' | 'email' | 'none';
}) {
  const [channel, setChannel] = React.useState(value);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <select
        aria-labelledby={labelId}
        value={channel}
        disabled={pending}
        data-testid="reminder-channel"
        className="min-h-11 rounded-control bg-surface px-3 text-sm hairline"
        onChange={(e) => {
          const next = e.target.value as typeof channel;
          const prev = channel;
          setChannel(next);
          setError(null);
          start(async () => {
            const res = await updateReminderPrefsAction({ channel: next });
            if (!res.ok) {
              setChannel(prev);
              setError(res.message);
            }
          });
        }}
      >
        <option value="none">Off</option>
        <option value="email">Email</option>
        <option value="push">Push (email if no device)</option>
      </select>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

export function ReminderToggle({
  labelId,
  settingKey,
  enabled,
}: {
  labelId: string;
  settingKey: 'revisit_reminders' | 'weekly_reflection' | 'monthly_retrospective';
  enabled: boolean;
}) {
  const [checked, setChecked] = React.useState(enabled);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next);
          setError(null);
          start(async () => {
            const res = await updateReminderPrefsAction({ [settingKey]: next });
            if (!res.ok) {
              setChecked(!next);
              setError(res.message);
            }
          });
        }}
        disabled={pending}
        data-testid={`reminder-${settingKey}`}
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}

export function QuietHours({
  start: initialStart,
  end: initialEnd,
}: {
  start: string | null;
  end: string | null;
}) {
  const [from, setFrom] = React.useState(initialStart ?? '');
  const [to, setTo] = React.useState(initialEnd ?? '');
  const [pending, run] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(
    null,
  );
  const save = (nextFrom: string, nextTo: string) =>
    run(async () => {
      setMessage(null);
      const res = await updateReminderPrefsAction({
        quiet_hours_start: nextFrom || null,
        quiet_hours_end: nextTo || null,
      });
      setMessage(res.ok ? { tone: 'info', text: 'Saved.' } : { tone: 'error', text: res.message });
    });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-fg-muted">from</span>
          <input
            type="time"
            value={from}
            disabled={pending}
            data-testid="quiet-from"
            className="min-h-11 rounded-control bg-surface px-2 hairline"
            onChange={(e) => {
              setFrom(e.target.value);
              save(e.target.value, to);
            }}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-fg-muted">to</span>
          <input
            type="time"
            value={to}
            disabled={pending}
            data-testid="quiet-to"
            className="min-h-11 rounded-control bg-surface px-2 hairline"
            onChange={(e) => {
              setTo(e.target.value);
              save(from, e.target.value);
            }}
          />
        </label>
      </div>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </div>
  );
}

function base64UrlToUint8Array(s: string): Uint8Array {
  const padding = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Push on this device: asks the browser once, registers the subscription, and switches the
 * channel to push. Without a VAPID key on the deployment it says so instead of failing.
 */
export function PushDeviceControl({
  vapidPublicKey,
  registeredEndpoints,
}: {
  vapidPublicKey: string | null;
  registeredEndpoints: string[];
}) {
  const [state, setState] = React.useState<
    | { kind: 'checking' }
    | { kind: 'unsupported' }
    | { kind: 'unavailable' }
    | { kind: 'denied' }
    | { kind: 'off' }
    | { kind: 'on'; endpoint: string }
  >({ kind: 'checking' });
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!vapidPublicKey) return setState({ kind: 'unavailable' });
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    )
      return setState({ kind: 'unsupported' });
    if (Notification.permission === 'denied') return setState({ kind: 'denied' });
    void navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub && registeredEndpoints.includes(sub.endpoint))
        setState({ kind: 'on', endpoint: sub.endpoint });
      else setState({ kind: 'off' });
    });
  }, [vapidPublicKey, registeredEndpoints]);

  const enable = () =>
    start(async () => {
      setError(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState({ kind: 'denied' });
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(vapidPublicKey!) as BufferSource,
          }));
        const res = await savePushSubscriptionAction(sub.toJSON());
        if (!res.ok) setError(res.message);
        else setState({ kind: 'on', endpoint: sub.endpoint });
      } catch {
        setError('This browser could not set up push. Email reminders still work.');
      }
    });

  const disable = (endpoint: string) =>
    start(async () => {
      setError(null);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => false);
      const res = await removePushSubscriptionAction(endpoint);
      if (!res.ok) setError(res.message);
      else setState({ kind: 'off' });
    });

  return (
    <div className="flex flex-col items-end gap-2">
      {state.kind === 'checking' ? (
        <span className="text-xs text-fg-muted">…</span>
      ) : state.kind === 'unavailable' ? (
        <span className="text-xs text-fg-muted">Not set up on this deployment</span>
      ) : state.kind === 'unsupported' ? (
        <span className="text-xs text-fg-muted">Not supported in this browser</span>
      ) : state.kind === 'denied' ? (
        <span className="text-xs text-fg-muted">Blocked in browser settings</span>
      ) : state.kind === 'on' ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => disable(state.endpoint)}
        >
          Turn off on this device
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={enable}
          data-testid="push-enable"
        >
          Allow on this device
        </Button>
      )}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
