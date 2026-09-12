import { cn } from '../lib/cn';

export type ConfidenceBand = 'low' | 'medium' | 'high';

/**
 * Qualitative bands only. The product never shows a numeric probability or certainty score
 * (invariant 13, §10). Thresholds mirror docs/ALGORITHMS.md link-state bands.
 */
export function bandFor(score: number): ConfidenceBand {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

const LABEL: Record<ConfidenceBand, string> = {
  low: 'low confidence',
  medium: 'moderate confidence',
  high: 'strong match',
};

export function ConfidenceBadge({
  score,
  band,
  className,
}: {
  score?: number;
  band?: ConfidenceBand;
  className?: string;
}) {
  const b = band ?? bandFor(score ?? 0);
  const dots = b === 'high' ? 3 : b === 'medium' ? 2 : 1;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-chip bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted',
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('size-1.5 rounded-full', i < dots ? 'bg-accent' : 'bg-hairline-strong')}
          />
        ))}
      </span>
      {LABEL[b]}
    </span>
  );
}
