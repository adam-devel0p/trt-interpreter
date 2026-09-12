import { PageHeader } from '@/ui/components/page-header';
import { SignUpForm } from '../_components/auth-forms';

export const metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <>
      <PageHeader
        title="Create your journal"
        description="Private by default. Nothing you write is shared, sold or used to train anything."
        className="pt-0"
      />
      <SignUpForm />
    </>
  );
}
