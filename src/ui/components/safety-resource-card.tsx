import { SAFETY_COPY, type SafetyCategory } from '@/domain/safety/categories';

/**
 * The §10 pointer to real help: calm, once per reading, never a refusal to read. Shown above
 * the interpretation. Plain markup so it reads the same without colour.
 */
export function SafetyResourceCard({ category }: { category: Exclude<SafetyCategory, 'none'> }) {
  const copy = SAFETY_COPY[category];
  return (
    <aside
      aria-labelledby="safety-h"
      data-safety-card={category}
      className="rounded-card bg-surface px-4 py-3 text-sm hairline"
    >
      <h3 id="safety-h" className="font-medium">
        {copy.heading}
      </h3>
      <p className="mt-1 text-fg-muted">{copy.body}</p>
      {copy.resources.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {copy.resources.map((r) => (
            <li key={r.label}>
              {r.contact.startsWith('http') ? (
                <a
                  href={r.contact}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-4"
                >
                  {r.label}
                </a>
              ) : (
                <span>
                  {r.label}: <span className="font-medium tabular-nums">{r.contact}</span>
                </span>
              )}
              <span className="text-fg-faint"> · {r.region}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
