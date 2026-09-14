import Link from 'next/link';
import * as React from 'react';
import {
  CLAIM_BASIS_LABEL,
  SUMMARY_SECTION_TITLE,
  SUMMARY_SECTIONS,
  type ClaimBasis,
  type StoredHighlights,
} from '@/domain/summaries/schema';

/**
 * A generated summary (FR-20, §9.2): the headline, then the four sections. Every claim
 * says what kind of thing it is — confirmed by you / from the cards / your reflection /
 * noticed by the app — and links to each entry it rests on, so nothing here is an
 * unattributed sentence (§19). Stored text only; nothing is generated on render.
 */
export interface SummaryTitles {
  /** Object id → a short title for the citation link. */
  get(id: string): { title: string; href: string } | undefined;
}

const BASIS_CLASS: Record<ClaimBasis, string> = {
  confirmed_fact: 'bg-accent/15 text-fg',
  tarot_interpretation: 'bg-surface-2 text-fg-muted',
  user_reflection: 'bg-surface-2 text-fg-muted',
  inferred: 'bg-surface-ai text-fg-muted',
};

export function SummaryView({
  id,
  headline,
  highlights,
  titles,
  stale,
  meta,
}: {
  id: string;
  headline: string;
  highlights: StoredHighlights;
  titles: SummaryTitles;
  stale: boolean;
  /** "Written 3 September · from 12 entries". */
  meta?: React.ReactNode;
}) {
  const sections = SUMMARY_SECTIONS.filter((s) => highlights[s]?.length);
  return (
    <div data-testid="summary-view" data-summary={id}>
      <p className="font-serif text-lg leading-snug">{headline}</p>
      {meta ? <p className="mt-1 text-xs text-fg-muted">{meta}</p> : null}
      {stale ? (
        <p className="mt-2 rounded-card border border-dashed border-hairline-strong px-3 py-2 text-sm text-fg-muted">
          An entry this summary rested on was deleted since it was written. What remains is still
          traceable; regenerate it for a fresh read.
        </p>
      ) : null}
      {sections.map((section) => (
        <section key={section} aria-labelledby={`${id}-${section}-h`} className="mt-4">
          <h4 id={`${id}-${section}-h`} className="mb-1.5 text-sm font-medium">
            {SUMMARY_SECTION_TITLE[section]}
          </h4>
          <ul className="flex flex-col gap-2">
            {highlights[section].map((c, i) => (
              <li key={i} className="rounded-card bg-surface px-3 py-2 text-sm hairline">
                <span
                  className={`mr-2 inline-block rounded-control px-1.5 py-0.5 text-[11px] font-medium tracking-wide uppercase ${BASIS_CLASS[c.basis]}`}
                >
                  {CLAIM_BASIS_LABEL[c.basis]}
                </span>
                <span>{c.text}</span>
                {c.citations.length ? (
                  <ul
                    className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs"
                    aria-label="Entries this rests on"
                  >
                    {c.citations.map((cit) => {
                      const t = titles.get(cit.id);
                      if (!t) return null;
                      return (
                        <li key={cit.id}>
                          <Link href={t.href} className="text-accent underline underline-offset-4">
                            {t.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
