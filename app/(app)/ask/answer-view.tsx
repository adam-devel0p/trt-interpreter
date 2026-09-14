import Link from 'next/link';
import type { AskClaim } from '@/db/queries/asks';
import type { AskEvidenceCard } from '@/retrieval/ask';
import { LocalTime } from '@/ui/components/local-time';

/**
 * An answer as the user sees it (spec §6.6, FR-19): the conclusion first, then the claims
 * with their evidence labels, then the evidence itself as tappable cards that open the
 * reading or event. "Not enough evidence" is a designed state: it shows what *was* found and
 * offers a narrower question. Renders stored data only — the same component serves the live
 * result and a reopened ask, and neither makes a model call.
 */

export interface AnswerViewModel {
  askId: string;
  question: string;
  conclusion: string;
  claims: AskClaim[];
  evidence: AskEvidenceCard[];
  evidenceSufficient: boolean;
  found: string | null;
  narrowerQuestion: string | null;
  packageSize: number;
  droppedCount: number;
  modelId: string | null;
}

export function evidenceHref(e: {
  type: 'reading' | 'life_event' | 'period_summary';
  id: string;
  periodKey?: string | null;
}): string {
  if (e.type === 'period_summary')
    return e.periodKey ? `/retrospective/${e.periodKey}` : '/retrospective';
  return e.type === 'reading' ? `/reading/${e.id}` : `/event/${e.id}`;
}

const TYPE_LABEL = {
  reading: 'Reading',
  life_event: 'Life event',
  period_summary: 'Summary written by the app',
} as const;

export function AnswerView({
  model,
  onNarrower,
  feedback,
}: {
  model: AnswerViewModel;
  /** Client-side: fills the composer with the narrower question. */
  onNarrower?: (q: string) => void;
  feedback?: React.ReactNode;
}) {
  const sufficient = model.evidenceSufficient;
  return (
    <article
      aria-labelledby={`ask-${model.askId}-h`}
      className="flex flex-col gap-5"
      data-ask={model.askId}
    >
      <div className="rounded-card bg-surface p-4 hairline">
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
          {sufficient ? 'From your history' : 'Not enough evidence'}
        </p>
        <h2 id={`ask-${model.askId}-h`} className="mt-1 font-serif text-xl leading-snug">
          {model.conclusion}
        </h2>
        {!sufficient && model.found ? <p className="mt-3 text-sm text-fg">{model.found}</p> : null}
        {!sufficient && model.narrowerQuestion ? (
          <p className="mt-3 text-sm text-fg-muted">
            A narrower question the evidence could answer:{' '}
            {onNarrower ? (
              <button
                type="button"
                className="text-accent underline underline-offset-4"
                onClick={() => onNarrower(model.narrowerQuestion!)}
              >
                {model.narrowerQuestion}
              </button>
            ) : (
              <Link
                href={`/ask?q=${encodeURIComponent(model.narrowerQuestion)}`}
                className="text-accent underline underline-offset-4"
              >
                {model.narrowerQuestion}
              </Link>
            )}
          </p>
        ) : null}
        {model.claims.length ? (
          <ol className="mt-4 flex flex-col gap-3 text-sm">
            {model.claims.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className="text-fg-faint">
                  ·
                </span>
                <span>
                  {c.text}{' '}
                  {c.citations.map((cit) => (
                    <a
                      key={cit.label}
                      href={`#ev-${model.askId}-${cit.label}`}
                      className="ml-0.5 rounded-control bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted"
                      aria-label={`Evidence ${cit.label}`}
                    >
                      {cit.label}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="mt-4 text-xs text-fg-faint">
          {sufficient
            ? 'One way to read your own entries, from the ones listed below and nothing else. Every claim links to what it rests on.'
            : 'The journal would rather say so than invent a pattern.'}
          {model.droppedCount > 0
            ? ` ${model.droppedCount} lower-ranked ${model.droppedCount === 1 ? 'entry was' : 'entries were'} left out to keep the answer grounded.`
            : ''}
        </p>
        {feedback}
      </div>

      {model.evidence.length ? (
        <section aria-labelledby={`ask-${model.askId}-ev`}>
          <h3 id={`ask-${model.askId}-ev`} className="mb-2 text-sm font-medium text-fg-muted">
            Evidence · {model.evidence.length} {model.evidence.length === 1 ? 'entry' : 'entries'}
          </h3>
          <ul className="flex flex-col gap-2">
            {model.evidence.map((e) => (
              <li key={e.label} id={`ev-${model.askId}-${e.label}`}>
                <Link
                  href={evidenceHref(e)}
                  className="block rounded-card bg-surface p-3 hairline hover:bg-surface-2"
                  aria-label={`${e.label}: ${TYPE_LABEL[e.type].toLowerCase()} on ${e.date}${e.title ? `, ${e.title}` : ''}`}
                  data-evidence={e.id}
                >
                  <div className="flex items-baseline justify-between gap-3 text-xs text-fg-muted">
                    <span>
                      <span className="rounded-control bg-surface-2 px-1.5 py-0.5">{e.label}</span>{' '}
                      {TYPE_LABEL[e.type]} · <LocalTime iso={`${e.date}T12:00:00Z`} dateOnly />
                    </span>
                    {e.deck ? <span>{e.deck}</span> : null}
                  </div>
                  <p className="mt-1 font-serif text-base leading-snug">
                    {e.title ?? 'Open reflection'}
                  </p>
                  {e.cards.length ? (
                    <p className="mt-1 text-xs text-fg-muted">{e.cards.join(' · ')}</p>
                  ) : null}
                  {e.why ? <p className="mt-1.5 text-sm text-fg-muted">{e.why}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
