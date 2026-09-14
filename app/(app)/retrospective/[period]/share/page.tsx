import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionClient, requireUser } from '@/auth/session';
import { parsePeriodKey } from '@/domain/summaries/periods';
import { flag } from '@/flags';
import { loadMonthForShare } from '@/share/load';
import { PageHeader } from '@/ui/components/page-header';
import { ShareStudio, type ShareOption } from '@/ui/components/share-studio';
import { noteShareAction } from '../../../share-actions';

export const metadata = { title: 'Share a month' };
export const dynamic = 'force-dynamic';

/** "My month in tarot" (§15.1): counts, recurring cards and themes; names and journeys by choice. */
export default async function Page({ params }: { params: Promise<{ period: string }> }) {
  const { period: key } = await params;
  const period = parsePeriodKey(key);
  if (!period || period.kind !== 'monthly') notFound();
  const user = await requireUser();
  if (!(await flag('share_cards', { userId: user.id }))) notFound();
  const month = await loadMonthForShare(await getSessionClient(), period);
  if (month.readings === 0) notFound();
  const options: ShareOption[] = [];
  if (month.journeyTitles.length)
    options.push({
      key: 'journeys',
      label: 'Journeys that moved',
      description: `Their titles can name people: ${month.journeyTitles.join(', ')}.`,
    });
  if (month.entityLabels.length)
    options.push({
      key: 'entities',
      label: 'People and places',
      description: `Names your readings mention: ${month.entityLabels.join(', ')}.`,
    });
  const shareMonth = noteShareAction.bind(null, 'month');
  return (
    <>
      <PageHeader
        eyebrow="Share"
        title={`${month.monthLabel} as an image`}
        description="How many readings and events, what kept coming back, the themes. No note, no question, no name unless you choose."
        action={
          <Link
            href={`/retrospective/${key}`}
            className="text-sm text-accent underline underline-offset-4"
          >
            Back
          </Link>
        }
      />
      <ShareStudio
        imageBase={`/api/share/month/${key}`}
        options={options}
        filename={`tarot-${key}.png`}
        onShared={shareMonth}
      />
    </>
  );
}
