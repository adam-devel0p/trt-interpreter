import { cn } from '../lib/cn';

/** Matches final layout shapes; motion collapses under prefers-reduced-motion. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-surface-2', className)}
      {...props}
    />
  );
}

/** A reading-card-shaped skeleton used by lists while content loads. */
export function SkeletonCard() {
  return (
    <div
      className="space-y-3 rounded-card bg-surface p-4 hairline"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}
