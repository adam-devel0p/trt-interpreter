import { redirect } from 'next/navigation';
import { ONBOARDING_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { getProfile } from '@/db/queries/profile';
import { AppShell } from '@/ui/components/app-shell';
import { BottomNav } from '@/ui/components/bottom-nav';

/**
 * Everything under (app) needs a signed-in user (the middleware guarantees it; this is the
 * server-side belt to that brace) and a finished onboarding. Unfinished onboarding resumes
 * at its stored step; it is never restarted.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const profile = await getProfile(await getSessionClient(), user.id);
  if (!profile?.onboarding_completed_at) redirect(ONBOARDING_PATH);
  return <AppShell nav={<BottomNav />}>{children}</AppShell>;
}
