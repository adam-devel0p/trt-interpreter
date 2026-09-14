'use client';

import * as React from 'react';
import { ASK_QUESTION_MAX, type AskScope } from '@/domain/retrieval/query';
import type { AskEvent, AskResult, AskStage } from '@/retrieval/ask';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { Skeleton } from '@/ui/components/skeleton';
import { cn } from '@/ui/lib/cn';
import { readSse } from '@/ui/lib/sse';
import { AnswerView, type AnswerViewModel } from './answer-view';
import { AskFeedback } from './ask-feedback';

/**
 * The Ask composer (spec §6.6): a question, a scope, example questions to start from. The
 * run streams its stages into a skeleton that says what is happening (a polite live region);
 * the answer appears once its citations are verified — nothing unverified is ever shown.
 * Stop cancels the request; the rest of the app is never blocked by an ask in flight.
 */

export interface ScopeOption {
  id: string;
  label: string;
}

export interface AskComposerProps {
  examples: readonly string[];
  journeys: ScopeOption[];
  entities: ScopeOption[];
  initialScope: AskScope;
  initialQuestion?: string;
  /** Pin the scope (the journey page's "Ask about this journey"). */
  lockScope?: boolean;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'running'; stage: AskStage | 'starting'; found: number | null }
  | { kind: 'done'; result: AskResult }
  | { kind: 'failed'; message: string };

const STAGE_COPY: Record<AskStage | 'starting', string> = {
  starting: 'Starting…',
  parsing: 'Reading your question…',
  searching: 'Searching your history…',
  ranking: 'Ranking what was found…',
  answering: 'Putting the evidence together…',
  verifying: 'Checking every citation…',
};

function toModel(r: AskResult): AnswerViewModel {
  return {
    askId: r.askId,
    question: r.question,
    conclusion: r.answer.conclusion,
    claims: r.claims,
    evidence: r.evidence,
    evidenceSufficient: r.answer.evidence_sufficient,
    found: r.answer.found,
    narrowerQuestion: r.answer.narrower_question,
    packageSize: r.packageSize,
    droppedCount: r.droppedCount,
    modelId: r.modelId,
  };
}

export function AskComposer({
  examples,
  journeys,
  entities,
  initialScope,
  initialQuestion,
  lockScope,
}: AskComposerProps) {
  const [question, setQuestion] = React.useState(initialQuestion ?? '');
  const [scope, setScope] = React.useState<AskScope>(initialScope);
  const [mode, setMode] = React.useState<Mode>({ kind: 'idle' });
  const abortRef = React.useRef<AbortController | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const running = mode.kind === 'running';

  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 3 || running) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setMode({ kind: 'running', stage: 'starting', found: null });
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed, scope }),
        signal: abort.signal,
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { kind?: string };
        setMode({
          kind: 'failed',
          message:
            body.kind === 'consent'
              ? 'Ask my history needs AI processing switched on in your profile.'
              : 'Ask my history is not switched on for this account yet.',
        });
        return;
      }
      if (!res.ok || !res.body) {
        setMode({
          kind: 'failed',
          message: 'Your history could not be searched just now. Try again in a moment.',
        });
        return;
      }
      let finished = false;
      await readSse(
        res,
        (type, data) => {
          const e = data as AskEvent;
          if (type === 'stage' && e.type === 'stage')
            setMode({ kind: 'running', stage: e.stage, found: e.found ?? null });
          else if (type === 'complete' && e.type === 'complete') {
            finished = true;
            setMode({ kind: 'done', result: e.result });
          } else if (type === 'failed' && e.type === 'failed') {
            finished = true;
            setMode(
              e.errorClass === 'cancelled'
                ? { kind: 'idle' }
                : { kind: 'failed', message: e.message },
            );
          }
        },
        abort.signal,
      );
      if (!finished && !abort.signal.aborted)
        setMode({
          kind: 'failed',
          message: 'The connection dropped before an answer arrived. Try again.',
        });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') setMode({ kind: 'idle' });
      else
        setMode({
          kind: 'failed',
          message: 'Your history could not be searched just now. Try again in a moment.',
        });
    }
  }

  function stop() {
    abortRef.current?.abort();
    setMode({ kind: 'idle' });
  }

  function askNarrower(q: string) {
    setQuestion(q);
    textareaRef.current?.focus();
    void ask(q);
  }

  const scopeKind = scope.kind;
  const setKind = (kind: AskScope['kind']) => {
    if (kind === 'all') setScope({ kind: 'all' });
    else if (kind === 'journey') setScope({ kind: 'journey', journeyId: journeys[0]?.id ?? '' });
    else if (kind === 'entity') setScope({ kind: 'entity', entityId: entities[0]?.id ?? '' });
    else setScope({ kind: 'range', start: null, end: null });
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ask-question" className="text-sm font-medium">
            Ask a question about your own history
          </label>
          <textarea
            ref={textareaRef}
            id="ask-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
            rows={2}
            maxLength={ASK_QUESTION_MAX}
            placeholder="What questions do I keep asking without resolving?"
            aria-describedby="ask-hint"
            className="min-h-11 w-full resize-y rounded-control bg-surface px-3 py-2 text-base text-fg hairline placeholder:text-fg-faint"
          />
          <p id="ask-hint" className="text-xs text-fg-muted">
            Answers come only from your own entries, with the sources listed. Thin evidence gets an
            honest “not enough evidence”, not a guess.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={lockScope}>
          <legend className="text-sm font-medium">Where to look</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Scope">
            {(
              [
                ['all', 'All history'],
                ['journey', 'A journey'],
                ['entity', 'A person or place'],
                ['range', 'A date range'],
              ] as const
            ).map(([kind, label]) => {
              const disabled =
                (kind === 'journey' && journeys.length === 0) ||
                (kind === 'entity' && entities.length === 0);
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={scopeKind === kind}
                  disabled={disabled || lockScope}
                  onClick={() => setKind(kind)}
                  className={cn(
                    'min-h-9 rounded-control px-3 text-sm hairline',
                    scopeKind === kind
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-fg hover:bg-surface-2',
                    disabled && 'opacity-50',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {scope.kind === 'journey' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">Journey</span>
              <select
                value={scope.journeyId}
                onChange={(e) => setScope({ kind: 'journey', journeyId: e.target.value })}
                className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
              >
                {journeys.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {scope.kind === 'entity' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">Person or place</span>
              <select
                value={scope.entityId}
                onChange={(e) => setScope({ kind: 'entity', entityId: e.target.value })}
                className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
              >
                {entities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {scope.kind === 'range' ? (
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">From</span>
                <input
                  type="date"
                  value={scope.start ?? ''}
                  onChange={(e) => setScope({ ...scope, start: e.target.value || null })}
                  className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">To</span>
                <input
                  type="date"
                  value={scope.end ?? ''}
                  onChange={(e) => setScope({ ...scope, end: e.target.value || null })}
                  className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
                />
              </label>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={running || question.trim().length < 3}>
            Ask
          </Button>
          {running ? (
            <Button type="button" variant="secondary" onClick={stop}>
              Stop
            </Button>
          ) : null}
        </div>
      </form>

      {mode.kind === 'idle' ? (
        <section aria-labelledby="ask-examples-h">
          <h2 id="ask-examples-h" className="mb-2 text-sm font-medium text-fg-muted">
            Questions to start from
          </h2>
          <ul className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(ex);
                    textareaRef.current?.focus();
                  }}
                  className="min-h-9 rounded-control bg-surface px-3 text-left text-sm hairline hover:bg-surface-2"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div role="status" aria-live="polite" aria-atomic="true">
        {mode.kind === 'running' ? (
          <div className="rounded-card bg-surface p-4 hairline" data-ask-stage={mode.stage}>
            <p className="text-sm text-fg-muted">
              {STAGE_COPY[mode.stage]}
              {mode.found !== null && mode.stage !== 'searching'
                ? ` ${mode.found} ${mode.found === 1 ? 'entry' : 'entries'} in scope.`
                : ''}
            </p>
            <div className="mt-3 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ) : null}
        {mode.kind === 'failed' ? <FormMessage tone="error">{mode.message}</FormMessage> : null}
      </div>

      {mode.kind === 'done' ? (
        <AnswerView
          model={toModel(mode.result)}
          onNarrower={askNarrower}
          feedback={<AskFeedback askId={mode.result.askId} initial={null} />}
        />
      ) : null}
    </div>
  );
}
