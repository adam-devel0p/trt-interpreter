import Link from 'next/link';
import { Button } from '@/ui/components/button';

/**
 * Public reference pages (§15.1): a plain header, the content, and exactly one contextual line
 * that points into journaling. Reference must never become the product, so there is no
 * secondary navigation, no related-content grid, no newsletter box.
 */
export function MarketingShell({
  children,
  funnel,
}: {
  children: React.ReactNode;
  /** The one funnel sentence for this page. */
  funnel: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-4">
      <a
        href="#main"
        className="sr-only rounded-control bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-serif text-lg">
          Tarot Journal
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-4 text-sm">
            <li>
              <Link href="/cards" className="text-fg-muted hover:text-fg">
                Cards
              </Link>
            </li>
            <li>
              <Link href="/spreads" className="text-fg-muted hover:text-fg">
                Spreads
              </Link>
            </li>
            <li>
              <Link href="/sign-in" className="text-fg-muted hover:text-fg">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" className="flex-1 pb-10">
        {children}
        <aside className="mt-10 flex flex-col gap-3 rounded-card bg-surface p-4 hairline sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted">{funnel}</p>
          <Button asChild size="sm" className="shrink-0">
            <Link href="/sign-up">Start a journal</Link>
          </Button>
        </aside>
      </main>
      <footer className="py-6 text-xs text-fg-faint">
        Tarot is reflection, not prediction. Card meanings are reference material for both deck
        systems, written in each system’s own terms.
      </footer>
    </div>
  );
}

/** Serialise JSON-LD safely (no `</script>` break-out). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
