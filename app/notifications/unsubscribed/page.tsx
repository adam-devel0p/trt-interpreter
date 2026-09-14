import Link from 'next/link';
import { REMINDER_KIND_LABEL } from '@/domain/notifications/copy';
import { REMINDER_KINDS } from '@/domain/notifications/rules';

export const metadata = { title: 'Reminder turned off' };

/** Where a one-tap unsubscribe lands: plain confirmation, no sign-in, one way back. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const kind = (REMINDER_KINDS as readonly string[]).includes(params.kind ?? '')
    ? REMINDER_KIND_LABEL[params.kind as (typeof REMINDER_KINDS)[number]]
    : 'these reminders';
  const ok = params.status === 'ok';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="font-serif text-2xl">{ok ? 'Turned off.' : 'That link has expired.'}</h1>
      <p className="text-fg-muted">
        {ok
          ? `You will not get ${kind} any more. Everything in your journal is exactly as it was. If you change your mind, the switch is in your profile under Reminders.`
          : 'Nothing changed. You can turn any reminder off from your profile under Reminders.'}
      </p>
      <Link href="/profile" className="text-accent underline underline-offset-4">
        Open profile
      </Link>
    </main>
  );
}
