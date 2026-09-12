import Link from 'next/link';

/** Narrow, calm column. The value message sits above every auth screen (§6.1: no wall first). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only rounded-control bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="mx-auto w-full max-w-[440px] px-4 pt-6">
        <Link href="/" className="font-serif text-lg">
          Tarot Journal
        </Link>
        <p className="mt-1 text-sm text-fg-muted">See how your readings connect over time.</p>
      </header>
      <main id="main" className="mx-auto w-full max-w-[440px] flex-1 px-4 pt-6 pb-12">
        {children}
      </main>
    </div>
  );
}
