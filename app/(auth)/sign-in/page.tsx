import { safeReturnPath } from '@/auth/routes';
import { PageHeader } from '@/ui/components/page-header';
import { SignInForm } from '../_components/auth-forms';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const notice =
    params.link === 'expired'
      ? 'That link has expired or was already used. Sign in, or request a new one.'
      : undefined;
  return (
    <>
      <PageHeader title="Sign in" className="pt-0" />
      <SignInForm next={next === '/home' ? undefined : next} notice={notice} />
    </>
  );
}
