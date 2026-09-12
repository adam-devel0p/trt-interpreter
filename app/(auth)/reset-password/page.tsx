import { getUser } from '@/auth/session';
import { FormMessage } from '@/ui/components/field';
import { PageHeader } from '@/ui/components/page-header';
import { ResetPasswordForm } from '../_components/auth-forms';

export const metadata = { title: 'Choose a new password' };

/** Landing screen for the recovery link. The link itself has already signed the user in. */
export default async function ResetPasswordPage() {
  const user = await getUser();
  return (
    <>
      <PageHeader title="Choose a new password" className="pt-0" />
      {user ? (
        <ResetPasswordForm />
      ) : (
        <FormMessage tone="info">
          This page only works from a reset link. Request one from the sign-in screen.
        </FormMessage>
      )}
    </>
  );
}
