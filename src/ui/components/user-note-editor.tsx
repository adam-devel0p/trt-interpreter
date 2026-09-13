'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export type SaveResult = { ok: true } | { ok: false; message: string };

export interface UserNoteEditorProps {
  id: string;
  label: string;
  initial: string;
  /** Persist the text. Called after a pause in typing and on blur, only when the text changed. */
  onSave: (text: string) => Promise<SaveResult>;
  placeholder?: string;
  maxLength?: number;
  autosaveMs?: number;
  rows?: number;
  className?: string;
}

/**
 * The user's own words (docs/DESIGN_SYSTEM.md → "The user's voice is visually first-class"):
 * content serif, plain paper ground, no container. Autosaves quietly; the status line says
 * Saving / Saved / could not save, and a failed save never touches the text on screen.
 */
export function UserNoteEditor({
  id,
  label,
  initial,
  onSave,
  placeholder,
  maxLength,
  autosaveMs = 900,
  rows = 5,
  className,
}: UserNoteEditorProps) {
  const [text, setText] = React.useState(initial);
  const [status, setStatus] = React.useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const lastSaved = React.useRef(initial);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef<Promise<void> | null>(null);

  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text === lastSaved.current) return;
    if (inFlight.current) await inFlight.current;
    if (text === lastSaved.current) return;
    setStatus('saving');
    const snapshot = text;
    const run = (async () => {
      const res = await onSave(snapshot);
      if (res.ok) {
        lastSaved.current = snapshot;
        setStatus('saved');
        setMessage(null);
      } else {
        setStatus('error');
        setMessage(res.message);
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
  }, [text, onSave]);

  React.useEffect(() => {
    if (text === lastSaved.current) return;
    setStatus('dirty');
    timer.current = setTimeout(() => void flush(), autosaveMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, autosaveMs, flush]);

  const statusText =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'error'
          ? (message ?? 'Could not save. Your words are still here.')
          : status === 'dirty'
            ? 'Unsaved changes'
            : '';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void flush()}
        aria-describedby={`${id}-status`}
        className="prose-content w-full resize-y rounded-control bg-transparent px-0 py-1 text-fg placeholder:text-fg-faint focus-visible:outline-offset-4"
      />
      <p
        id={`${id}-status`}
        role="status"
        aria-live="polite"
        className={cn('min-h-5 text-xs', status === 'error' ? 'text-danger' : 'text-fg-muted')}
      >
        {statusText}
      </p>
    </div>
  );
}
