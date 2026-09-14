import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { flag } from '@/flags';
import { loadReadingForShare } from '@/share/load';
import { PageHeader } from '@/ui/components/page-header';
import { ShareStudio, type ShareOption } from '@/ui/components/share-studio';
import { noteShareAction } from '../../../share-actions';

export const metadata = { title: 'Share a reading' };
export const dynamic = 'force-dynamic';

/** Share a reading as an image (FR-24): private by default, exact preview, opt-ins per element. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  if (!(await flag('share_cards', { userId: user.id }))) notFound();
  const reading = await loadReadingForShare(await getSessionClient(), id);
  if (!reading) notFound();
  const options: ShareOption[] = [];
  if (reading.question)
    options.push({
      key: 'question',
      label: 'The question',
      description: 'The exact words you asked.',
    });
  if (reading.notes)
    options.push({
      key: 'notes',
      label: 'A line from your note',
      description: 'The first 160 characters of your own note.',
    });
  if (reading.entityLabels.length)
    options.push({
      key: 'entities',
      label: 'People and places',
      description: `Names this reading mentions: ${reading.entityLabels.join(', ')}.`,
    });
  const shareReading = noteShareAction.bind(null, 'reading');
  return (
    <>
      <PageHeader
        eyebrow="Share"
        title="A reading as an image"
        description="Your cards and their positions, the date and deck. Private things stay off unless you say otherwise."
        action={
          <Link
            href={`/reading/${id}`}
            className="text-sm text-accent underline underline-offset-4"
          >
            Back
          </Link>
        }
      />
      <ShareStudio
        imageBase={`/api/share/reading/${id}`}
        options={options}
        filename={`tarot-reading-${reading.occurredAt.slice(0, 10)}.png`}
        onShared={shareReading}
      />
    </>
  );
}
