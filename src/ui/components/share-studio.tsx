'use client';

import * as React from 'react';
import { Button } from './button';
import { FormMessage } from './field';

/**
 * The share studio (FR-24, §11): each private element is an explicit opt-in, and the preview
 * is the very image that will leave the device — the same route, the same options. No
 * public URL is ever created: the user gets a file and posts it where they choose.
 */
export interface ShareOption {
  key: 'question' | 'notes' | 'entities' | 'journeys';
  label: string;
  description: string;
}

export function ShareStudio({
  imageBase,
  options,
  filename,
  onShared,
}: {
  imageBase: string;
  options: ShareOption[];
  filename: string;
  /** Server action recording that a card left the device (a count, never the image). */
  onShared?: (method: 'share' | 'download') => void | Promise<void>;
}) {
  const [on, setOn] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [canShare, setCanShare] = React.useState(false);
  const query = React.useMemo(() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(on)) if (v) q.set(k, '1');
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [on]);
  const src = `${imageBase}${query}`;
  React.useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const fetchFile = async () => {
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('render failed');
    return new File([await res.blob()], filename, { type: 'image/png' });
  };
  const share = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const file = await fetchFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        void onShared?.('share');
      } else {
        await download(file);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError')
        setMessage('The image could not be prepared. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const download = async (file?: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const f = file ?? (await fetchFile());
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      void onShared?.('download');
    } catch {
      setMessage('The image could not be prepared. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="share-studio">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What the image includes</legend>
        <p className="text-sm text-fg-muted">
          Cards, positions, date, deck and themes are always on it. Everything below is off unless
          you switch it on.
        </p>
        {options.map((o) => (
          <label
            key={o.key}
            className="flex items-start gap-3 rounded-card bg-surface px-3 py-2.5 hairline"
          >
            <input
              type="checkbox"
              className="mt-1 size-4 accent-accent"
              checked={!!on[o.key]}
              data-testid={`share-opt-${o.key}`}
              onChange={(e) => setOn((s) => ({ ...s, [o.key]: e.target.checked }))}
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{o.label}</span>
              <span className="text-xs text-fg-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <figure className="flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- the exact server-rendered file, unoptimised on purpose */}
        <img
          src={src}
          alt="Exact preview of the image that will be shared"
          width={540}
          height={675}
          className="w-full max-w-sm self-center rounded-card hairline"
          data-testid="share-preview"
        />
        <figcaption className="text-center text-xs text-fg-muted">
          This is the exact image. Nothing else is added when you share it.
        </figcaption>
      </figure>
      <div className="flex flex-wrap gap-2">
        {canShare ? (
          <Button type="button" onClick={share} disabled={busy}>
            Share…
          </Button>
        ) : null}
        <Button
          type="button"
          variant={canShare ? 'secondary' : 'primary'}
          onClick={() => download()}
          disabled={busy}
        >
          Download image
        </Button>
      </div>
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
    </div>
  );
}
