import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

// Placeholder: real auth arrives in Phase 01.
export default function SignInPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4">
      <PageHeader title="Sign in" />
      <EmptyState
        title="Sign-in is not wired yet"
        description="Authentication lands in Phase 01. Everything you write will be private to your account."
      />
    </div>
  );
}
