import type { NoteRevision } from '@/db/queries/readings';
import { LocalTime } from './local-time';

/**
 * Every earlier version of the user's question and notes, newest first (invariant 4: raw
 * user text is never discarded). Folded by default; the text keeps the serif-on-paper
 * treatment because it is the user's, not a model's.
 */
export function NoteHistory({ revisions }: { revisions: NoteRevision[] }) {
  return (
    <details className="group rounded-card bg-surface hairline">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span>
          Earlier versions <span className="text-fg-muted">({revisions.length})</span>
        </span>
        <span
          aria-hidden="true"
          className="text-fg-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <ol className="divide-y divide-hairline border-t border-hairline">
        {revisions.map((r) => (
          <li key={r.id} className="px-3 py-3">
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
              {r.field === 'question' ? 'Question' : 'Notes'}
              <span className="tracking-normal normal-case">
                {' '}
                · until <LocalTime iso={r.replaced_at} />
              </span>
            </p>
            <p className="prose-content mt-1 whitespace-pre-wrap">{r.content}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
