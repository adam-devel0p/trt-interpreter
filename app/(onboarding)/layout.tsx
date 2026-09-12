/** Onboarding runs without the app chrome: one column, one action per screen. */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only rounded-control bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <main id="main" className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 pt-8 pb-12">
        {children}
      </main>
    </div>
  );
}
