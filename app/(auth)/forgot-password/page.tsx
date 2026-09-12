import { PageHeader } from '@/ui/components/page-header';
import { ForgotPasswordForm } from '../_components/auth-forms';

export const metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <>
      <PageHeader
        title="Reset your password"
        description="Enter your email and we'll send a link to choose a new one."
        className="pt-0"
      />
      <ForgotPasswordForm />
    </>
  );
}
