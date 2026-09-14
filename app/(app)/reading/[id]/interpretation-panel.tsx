'use client';

import Link from 'next/link';
import * as React from 'react';
import type {
  CompleteInterpretation,
  InterpretationRow,
  SafetyFlagRow,
} from '@/db/queries/interpretations';
import { partialInterpretation } from '@/domain/interpretation/partialJson';
import type { PartialInterpretation } from '@/domain/interpretation/schema';
import type { SafetyCategory } from '@/domain/safety/categories';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import {
  LayeredInterpretation,
  type InterpretationCardRef,
} from '@/ui/components/layered-interpretation';
import { SafetyResourceCard } from '@/ui/components/safety-resource-card';
import { cn } from '@/ui/lib/cn';
import { readSse } from '@/ui/lib/sse';
import { setInterpretationFeedbackAction } from '../actions';

export interface InterpretationPanelProps {
  readingId: string;
  metadataVersion: number;
  cards: InterpretationCardRef[];
  consent: boolean;
  collapsedByDefault: boolean;
  initial: { current: CompleteInterpretation | null; latest: InterpretationRow | null };
  safetyFlags: SafetyFlagRow[];
  /** Straight after the save: kick off the first interpretation without a tap. */
  autoStart: boolean;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'stored'; row: CompleteInterpretation }
  | { kind: 'streaming'; interpretationId: string | null; text: string }
  | { kind: 'in_progress'; row: InterpretationRow }
  | {
      kind: 'failed';
      interpretationId: string | null;
      message: string;
      partial: PartialInterpretation | null;
    };

type Surfaced = Exclude<SafetyCategory, 'none'>;

const POLL_MS = 2000;

function rowLayers(row: InterpretationRow): PartialInterpretation {
  return {
    synthesis: row.synthesis ?? undefined,
    per_card: (row.per_card as PartialInterpretation['per_card']) ?? undefined,
    combined: row.combined ?? undefined,
    reflective_prompts: row.reflective_prompts ?? undefined,
  };
}

function hasAnyLayer(p: PartialInterpretation | null): p is PartialInterpretation {
  return (
    !!p && (p.synthesis !== undefined || (p.per_card?.length ?? 0) > 0 || p.combined !== undefined)
  );
}

/**
 * The AI interpretation island (§9.3, §13). Stored layers render from props with no request;
 * a new run streams over SSE and shows layers as they arrive; a run in flight elsewhere is
 * polled; every failure keeps the reading usable and offers one plain retry. The user's own
 * note lives above this panel and is never touched by it.
 */
export function InterpretationPanel({
  readingId,
  metadataVersion,
  cards,
  consent,
  collapsedByDefault,
  initial,
  safetyFlags,
  autoStart,
}: InterpretationPanelProps) {
  const [mode, setMode] = React.useState<Mode>(() => {
    if (initial.current) return { kind: 'stored', row: initial.current };
    const l = initial.latest;
    if (l && (l.status === 'pending' || l.status === 'streaming'))
      return { kind: 'in_progress', row: l };
    if (l && l.status === 'failed') {
      return {
        kind: 'failed',
        interpretationId: l.id,
        message: failureCopy(l.error_class),
        partial: hasAnyLayer(rowLayers(l)) ? rowLayers(l) : null,
      };
    }
    return { kind: 'idle' };
  });
  const [safety, setSafety] = React.useState<Surfaced | null>(
    () => (safetyFlags.find((f) => f.surfaced_at)?.category as Surfaced | undefined) ?? null,
  );
  const [regenNote, setRegenNote] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRef = React.useRef(false);

  const start = React.useCallback(
    async (regenerate: boolean) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      const previous = mode.kind === 'stored' ? mode.row : null;
      setRegenNote(null);
      setMode({ kind: 'streaming', interpretationId: null, text: '' });
      let text = '';
      let interpretationId: string | null = null;
      try {
        const res = await fetch(`/api/readings/${readingId}/interpret`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ regenerate }),
          signal: abort.signal,
        });
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          const body = (await res.json()) as { kind?: string; interpretation?: InterpretationRow };
          if (res.status === 403 || body.kind === 'consent') {
            setMode({
              kind: 'failed',
              interpretationId: null,
              message: failureCopy('consent'),
              partial: null,
            });
            return;
          }
          if (body.kind === 'stored' && body.interpretation) {
            setMode({ kind: 'stored', row: body.interpretation as CompleteInterpretation });
            return;
          }
          if (body.kind === 'in_progress' && body.interpretation) {
            setMode({ kind: 'in_progress', row: body.interpretation });
            return;
          }
          setMode({
            kind: 'failed',
            interpretationId: null,
            message: failureCopy('unavailable'),
            partial: null,
          });
          return;
        }
        await readSse(
          res,
          (type, data) => {
            const e = data as Record<string, unknown>;
            if (type === 'started') {
              interpretationId = String(e.interpretationId);
              setMode({ kind: 'streaming', interpretationId, text });
            } else if (type === 'safety') {
              setSafety(e.category as Surfaced);
            } else if (type === 'text') {
              text += String(e.text);
              const snapshot = text;
              setMode((m) => (m.kind === 'streaming' ? { ...m, text: snapshot } : m));
            } else if (type === 'reset') {
              text = '';
              setMode((m) => (m.kind === 'streaming' ? { ...m, text: '' } : m));
            } else if (type === 'complete') {
              setMode({ kind: 'stored', row: e.interpretation as CompleteInterpretation });
            } else if (type === 'failed') {
              const partial = partialInterpretation(text);
              if (previous && regenerate) {
                setMode({ kind: 'stored', row: previous });
                setRegenNote(String(e.message));
              } else {
                setMode({
                  kind: 'failed',
                  interpretationId,
                  message: String(e.message),
                  partial: hasAnyLayer(partial) ? partial : null,
                });
              }
            }
          },
          abort.signal,
        );
        // Stream closed without a terminal event: the run continues server-side; poll for it.
        setMode((m) =>
          m.kind === 'streaming'
            ? {
                kind: 'in_progress',
                row: { id: m.interpretationId ?? '', status: 'streaming' } as InterpretationRow,
              }
            : m,
        );
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setMode({
          kind: 'failed',
          interpretationId,
          message: failureCopy('unavailable'),
          partial: hasAnyLayer(partialInterpretation(text)) ? partialInterpretation(text) : null,
        });
      }
    },
    [readingId, mode],
  );

  // First interpretation straight after saving (consent already checked by the page).
  React.useEffect(() => {
    if (autoStart && consent && mode.kind === 'idle' && !startedRef.current) {
      startedRef.current = true;
      void start(false);
    }
  }, [autoStart, consent, mode.kind, start]);

  // A run in flight elsewhere (another tab, a reload mid-stream): attach or poll.
  React.useEffect(() => {
    if (mode.kind !== 'in_progress') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/readings/${readingId}/interpret`, { cache: 'no-store' });
        const body = (await res.json()) as {
          current: CompleteInterpretation | null;
          latest: InterpretationRow | null;
          live: boolean;
          safetyFlags: SafetyFlagRow[];
        };
        if (cancelled) return;
        const flagged = body.safetyFlags?.find((f) => f.surfaced_at)?.category as
          Surfaced | undefined;
        if (flagged) setSafety(flagged);
        if (body.live) {
          // Same instance: attach to the live stream instead of polling.
          void start(false);
          return;
        }
        if (body.current) setMode({ kind: 'stored', row: body.current });
        else if (body.latest?.status === 'failed') {
          setMode({
            kind: 'failed',
            interpretationId: body.latest.id,
            message: failureCopy(body.latest.error_class),
            partial: hasAnyLayer(rowLayers(body.latest)) ? rowLayers(body.latest) : null,
          });
        } else if (body.latest) setMode({ kind: 'in_progress', row: body.latest });
        else setMode({ kind: 'idle' });
      } catch {
        /* keep polling */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mode.kind, readingId, start]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const stop = async () => {
    abortRef.current?.abort();
    const text = mode.kind === 'streaming' ? mode.text : '';
    const partial = partialInterpretation(text);
    setMode({
      kind: 'failed',
      interpretationId: mode.kind === 'streaming' ? mode.interpretationId : null,
      message: failureCopy('cancelled'),
      partial: hasAnyLayer(partial) ? partial : null,
    });
    await fetch(`/api/readings/${readingId}/interpret`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  };

  const safetyCard = safety ? <SafetyResourceCard category={safety} /> : null;

  if (!consent) {
    return (
      <div className="flex flex-col gap-3">
        {safetyCard}
        <div className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm text-fg-muted">
          <p className="font-medium text-fg">AI interpretation is off.</p>
          <p className="mt-1">
            Your reading is complete without it. If you would like one, turn on AI processing in{' '}
            <Link href="/profile" className="text-accent underline underline-offset-4">
              Profile
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  if (mode.kind === 'idle') {
    return (
      <div className="flex flex-col gap-3">
        {safetyCard}
        <div className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm text-fg-muted">
          <p className="font-medium text-fg">Not generated.</p>
          <p className="mt-1">
            Optional. It uses your question, the cards in their positions and your note; nothing is
            sent until you ask.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => void start(false)}
          >
            Generate interpretation
          </Button>
        </div>
      </div>
    );
  }

  if (mode.kind === 'in_progress') {
    return (
      <div className="flex flex-col gap-3">
        {safetyCard}
        <LayeredInterpretation
          layers={rowLayers(mode.row)}
          cards={cards}
          streaming
          collapsedByDefault={collapsedByDefault}
          actions={
            <p className="text-xs text-fg-muted">Writing in the background — this page keeps up.</p>
          }
        />
      </div>
    );
  }

  if (mode.kind === 'streaming') {
    return (
      <div className="flex flex-col gap-3">
        {safetyCard}
        <LayeredInterpretation
          layers={partialInterpretation(mode.text)}
          cards={cards}
          streaming
          collapsedByDefault={collapsedByDefault}
          actions={
            <Button type="button" variant="ghost" onClick={() => void stop()}>
              Stop
            </Button>
          }
        />
      </div>
    );
  }

  if (mode.kind === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        {safetyCard}
        {mode.partial ? (
          <LayeredInterpretation
            layers={mode.partial}
            cards={cards}
            collapsedByDefault={collapsedByDefault}
          />
        ) : null}
        <div
          role="status"
          className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm"
        >
          <p className="font-medium">Interpretation unavailable — your reading is saved.</p>
          <p className="mt-1 text-fg-muted">{mode.message}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => void start(false)}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const row = mode.row;
  const stale = row.metadata_version !== metadataVersion;
  return (
    <div className="flex flex-col gap-3">
      {safetyCard}
      {regenNote ? <FormMessage tone="error">{regenNote}</FormMessage> : null}
      <LayeredInterpretation
        layers={rowLayers(row)}
        cards={cards}
        collapsedByDefault={collapsedByDefault}
        stale={stale}
        meta={{
          modelId: row.model_id,
          promptVersion: row.prompt_version,
          generatedAt: row.generated_at,
        }}
        actions={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Feedback key={row.id} interpretationId={row.id} initial={row.feedback} />
            <Button type="button" variant="ghost" onClick={() => void start(true)}>
              {stale ? 'Generate for the current cards' : 'Regenerate'}
            </Button>
          </div>
        }
      />
    </div>
  );
}

function failureCopy(errorClass: string | null | undefined): string {
  switch (errorClass) {
    case 'budget_denied':
      return 'You have reached the interpretation limit for now. Your reading and notes are saved and stay readable.';
    case 'refusal':
      return 'The model declined to interpret this reading. The reference meanings below are still here.';
    case 'deck_purity':
      return 'The generated text mixed in vocabulary from another deck, so it was not kept. The deck-native reference meanings are below.';
    case 'timeout':
      return 'The interpretation took too long and was stopped. Try again in a moment.';
    case 'cancelled':
      return 'Stopped. What arrived so far is kept; you can generate again whenever you like.';
    case 'consent':
      return 'AI interpretation is off for your account. Turn it on in Profile if you want one.';
    case 'invalid_output':
      return 'The interpretation came back in a shape the app could not use. You can try again.';
    default:
      return 'The interpretation service is not responding right now. Try again later.';
  }
}

/** Thumbs up / down with an optional short reason (§16). The reason is the user's own words. */
function Feedback({
  interpretationId,
  initial,
}: {
  interpretationId: string;
  initial: -1 | 1 | null;
}) {
  const [value, setValue] = React.useState<-1 | 1 | null>(initial);
  const [reasonOpen, setReasonOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [pending, start] = React.useTransition();
  const send = (next: -1 | 1 | null, why: string | null) =>
    start(async () => {
      const res = await setInterpretationFeedbackAction(interpretationId, next, why);
      if (res.ok) setSaved(true);
    });
  const choose = (v: -1 | 1) => {
    const next = value === v ? null : v;
    setValue(next);
    setSaved(false);
    setReasonOpen(next !== null);
    send(next, null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Was this interpretation useful?"
        className="flex items-center gap-1"
      >
        <span className="mr-1 text-xs text-fg-muted">Useful?</span>
        {(
          [
            [1, 'Yes'],
            [-1, 'Not really'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            disabled={pending}
            onClick={() => choose(v)}
            className={cn(
              'min-h-11 rounded-chip px-3 text-sm font-medium hairline',
              value === v ? 'bg-accent-soft' : 'bg-surface hover:bg-surface-2',
            )}
          >
            {label}
          </button>
        ))}
        {saved ? (
          <span role="status" className="text-xs text-fg-muted">
            Noted.
          </span>
        ) : null}
      </div>
      {reasonOpen && value !== null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(value, reason);
            setReasonOpen(false);
          }}
        >
          <label htmlFor={`fb-${interpretationId}`} className="text-xs text-fg-muted">
            Anything specific? Optional.
          </label>
          <input
            id={`fb-${interpretationId}`}
            value={reason}
            maxLength={280}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-control bg-surface px-3 py-2 text-sm text-fg hairline"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              Send
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReasonOpen(false)}>
              Skip
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
