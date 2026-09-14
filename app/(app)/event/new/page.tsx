import Link from 'next/link';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getReading } from '@/db/queries/readings';
import { PageHeader } from '@/ui/components/page-header';
import { EventForm } from '../event-form';

export const metadata = { title: 'Something happened' };
export const dynamic = 'force-dynamic';

/**
 * Quick event entry (spec §6.4): one tap from Home, Journal or a reading. No multi-field
 * form, no required tarot framing. A `reading` query parameter ("something happened about
 * this") pre-links the event to that reading as the user's own, confirmed connection.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ reading?: string }>;
}) {
  const { reading: readingParam } = await searchParams;
  await requireUser();
  const client = await getSessionClient();
  const readingId = z.string().uuid().safeParse(readingParam);
  const reading = readingId.success ? await getReading(client, readingId.data) : null;
  const readingTitle = reading
    ? reading.is_open_reflection
      ? 'Open reflection'
      : reading.question
    : null;
  return (
    <>
      <PageHeader
        eyebrow="Life event"
        title="Something happened"
        description="Log it in one sentence. If it relates to a past reading, the app may suggest the connection — you decide."
        action={
          <Link
            href={reading ? `/reading/${reading.id}` : '/home'}
            className="text-sm text-accent underline underline-offset-4"
          >
            Cancel
          </Link>
        }
      />
      <EventForm readingId={reading?.id ?? null} readingTitle={readingTitle} />
    </>
  );
}
