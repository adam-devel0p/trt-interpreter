import Link from 'next/link';
import { Button } from '@/ui/components/button';

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-4">
      <header className="flex items-center justify-between py-5">
        <span className="font-serif text-lg">Tarot Journal</span>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-4 text-sm">
            <li>
              <Link href="/sign-in" className="text-fg-muted hover:text-fg">
                Sign in
              </Link>
            </li>
            <li>
              <Button asChild size="sm">
                <Link href="/home">Open journal</Link>
              </Button>
            </li>
          </ul>
        </nav>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <p className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">
          Private by design
        </p>
        <h1 className="font-serif text-4xl leading-tight font-medium tracking-tight sm:text-5xl">
          A tarot journal that remembers.
        </h1>
        <p className="prose-content mt-5 max-w-prose text-fg-muted">
          Save each reading in seconds — from a digital draw or your own deck — and watch isolated
          readings become a timeline: what you asked, what you noticed, what happened next.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/sign-up">Start your first reading</Link>
          </Button>
        </div>
      </main>
      <footer className="py-6 text-xs text-fg-faint">
        Tarot is reflection, not prediction. Your entries stay yours: export or delete any time.
      </footer>
    </div>
  );
}
