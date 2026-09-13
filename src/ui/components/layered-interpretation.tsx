import * as React from 'react';
import type { PartialInterpretation } from '@/domain/interpretation/schema';
import { cn } from '../lib/cn';

export interface InterpretationCardRef {
  position_index: number;
  positionName: string;
  cardName: string;
  orientation: 'upright' | 'reversed';
}

export interface LayeredInterpretationProps {
  /** Complete or partial layers; strings may end mid-sentence while streaming. */
  layers: PartialInterpretation;
  cards: InterpretationCardRef[];
  streaming?: boolean;
  /** Experienced readers: card-by-card and combined layers start folded (§9.3). */
  collapsedByDefault?: boolean;
  /** Generated against an earlier version of the cards. */
  stale?: boolean;
  meta?: { modelId: string | null; promptVersion: string; generatedAt: string | null } | null;
  /** Rendered under the text: feedback, regenerate, stop. */
  actions?: React.ReactNode;
  className?: string;
}

function Layer({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group border-t border-hairline pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span
          aria-hidden="true"
          className="text-fg-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

/** "…" while a string is still arriving, so a cut-off sentence reads as in progress, not wrong. */
function Growing({ text, streaming }: { text: string | undefined; streaming: boolean }) {
  if (text === undefined) return null;
  return (
    <>
      {text}
      {streaming ? (
        <span aria-hidden="true" className="text-fg-faint">
          ▍
        </span>
      ) : null}
    </>
  );
}

/**
 * The layered interpretation (§9.3; DESIGN_SYSTEM "distinguishing user text from AI text"):
 * UI sans in a tinted container with a hairline left edge, labelled "suggested", conclusion
 * first and depth behind native disclosure so it is keyboard-operable by construction.
 * Streaming is announced by stage in a polite live region, never token by token.
 */
export function LayeredInterpretation({
  layers,
  cards,
  streaming = false,
  collapsedByDefault = false,
  stale = false,
  meta,
  actions,
  className,
}: LayeredInterpretationProps) {
  const byPosition = new Map(cards.map((c) => [c.position_index, c]));
  const perCard = layers.per_card ?? [];
  const stage = streaming
    ? layers.reflective_prompts?.length
      ? 'Finishing.'
      : layers.combined !== undefined
        ? 'Reading the cards together.'
        : perCard.length
          ? `Card ${Math.min(perCard.length, cards.length)} of ${cards.length}.`
          : layers.synthesis !== undefined
            ? 'Synthesis ready.'
            : 'Starting.'
    : 'Interpretation complete.';
  const lastIsStreaming = (i: number) =>
    streaming && i === perCard.length - 1 && layers.combined === undefined;

  return (
    <div
      data-ai-content="true"
      className={cn(
        'rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 font-sans text-sm',
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
        <span>AI interpretation</span>
        <span aria-hidden="true">·</span>
        <span className="tracking-normal normal-case">suggested, one way to read this</span>
        {streaming ? (
          <span className="tracking-normal normal-case">
            <span aria-hidden="true">· </span>writing…
          </span>
        ) : null}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {stage}
      </p>
      {stale ? (
        <p className="mt-2 rounded-control bg-surface px-3 py-2 text-xs text-fg-muted hairline">
          This interpretation was written for an earlier version of the cards. You can generate a
          new one; this one stays as it was.
        </p>
      ) : null}

      {layers.synthesis !== undefined ? (
        <p className="mt-2 text-base leading-relaxed text-fg">
          <Growing text={layers.synthesis} streaming={streaming && perCard.length === 0} />
        </p>
      ) : streaming ? (
        <div aria-hidden="true" className="mt-3 flex flex-col gap-2">
          <div className="h-4 w-11/12 animate-pulse rounded-control bg-surface-2" />
          <div className="h-4 w-2/3 animate-pulse rounded-control bg-surface-2" />
        </div>
      ) : null}

      {perCard.length > 0 ? (
        <div className="mt-3">
          <Layer title="Card by card" open={!collapsedByDefault || streaming}>
            <ol className="flex flex-col gap-3">
              {perCard.map((c, i) => {
                const ref =
                  c.position_index !== undefined ? byPosition.get(c.position_index) : undefined;
                return (
                  <li key={c.position_index ?? i}>
                    <p className="text-xs font-medium text-fg-muted">
                      {ref ? (
                        <>
                          {ref.position_index + 1} · {ref.positionName} — {ref.cardName}
                          {ref.orientation === 'reversed' ? ', reversed' : ''}
                        </>
                      ) : (
                        `Card ${(c.position_index ?? i) + 1}`
                      )}
                    </p>
                    <p className="mt-1 leading-relaxed">
                      <Growing text={c.text} streaming={lastIsStreaming(i)} />
                    </p>
                    {c.nuances && c.nuances.length > 0 ? (
                      <ul
                        aria-label="Other ways to read it"
                        className="mt-1.5 flex flex-col gap-1 pl-4 text-fg-muted"
                      >
                        {c.nuances.map((n, j) => (
                          <li key={j} className="list-disc">
                            {n}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Layer>
        </div>
      ) : null}

      {layers.combined !== undefined ? (
        <Layer title="Read together" open={!collapsedByDefault || streaming}>
          <p className="leading-relaxed">
            <Growing text={layers.combined} streaming={streaming && !layers.reflective_prompts} />
          </p>
        </Layer>
      ) : null}

      {layers.reflective_prompts && layers.reflective_prompts.length > 0 ? (
        <Layer title="Questions to sit with" open={!collapsedByDefault}>
          <ul className="flex flex-col gap-1.5">
            {layers.reflective_prompts.map((p, i) => (
              <li key={i} className="font-serif text-base leading-relaxed">
                {p}
              </li>
            ))}
          </ul>
        </Layer>
      ) : null}

      {actions ? <div className="mt-3 border-t border-hairline pt-3">{actions}</div> : null}

      {meta && !streaming ? (
        <details className="mt-2 text-xs text-fg-muted">
          <summary className="min-h-8 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            Why am I seeing this?
          </summary>
          <p className="mt-1">
            Written by a model from this deck’s own reference text for these cards in these
            positions, your question and your note. It is a reflection, not a prediction, and it
            never changes your words.
            {meta.modelId ? ` Model ${meta.modelId} · prompt ${meta.promptVersion}.` : ''}
          </p>
        </details>
      ) : null}
    </div>
  );
}
