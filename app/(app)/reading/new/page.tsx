import Link from 'next/link';
import { HOME_PATH } from '@/auth/routes';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'New reading' };

/** Phase 03 stub. Onboarding hands off here; the real reading loop replaces this file. */
export default function NewReadingPage() {
  return (
    <>
      <PageHeader title="Your first reading" />
      <EmptyState
        title="The reading screen is on its way"
        description="Digital draws and physical-deck entry arrive in the next phase. Your account and preferences are saved; nothing you've done is lost."
        action={
          <Button asChild variant="secondary">
            <Link href={HOME_PATH}>Go to Home</Link>
          </Button>
        }
      />
    </>
  );
}
