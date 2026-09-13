import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getReading } from '@/db/queries/readings';
import { isFutureFacing } from '@/domain/readings/futureFacing';
import { ReadingDetail } from '@/ui/components/reading-detail';
import { ReadingControls, FollowUpControl, NotesEditor, RevisitChips } from './controls';

export const dynamic = 'force-dynamic';

/**
 * Reading detail (§6.3). One read through the query layer; the client islands are bound to
 * server actions. No model is called when this opens — everything shown is stored.
 */
export default async function ReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  await requireUser();
  const reading = await getReading(await getSessionClient(), id);
  if (!reading) notFound();
  const justSaved = saved === '1';
  const offerRevisit =
    justSaved &&
    reading.revisit_at === null &&
    isFutureFacing({ question: reading.question, positions: reading.spread.positions });

  return (
    <ReadingDetail
      reading={reading}
      justSaved={justSaved}
      cardHref={(c) => `/decks/${reading.deck.slug}/${c.card.slug}`}
      slots={{
        notes: <NotesEditor readingId={reading.id} initial={reading.user_notes ?? ''} />,
        followUp: (
          <FollowUpControl
            readingId={reading.id}
            status={reading.follow_up_status}
            revisitAt={reading.revisit_at}
          />
        ),
        revisit: offerRevisit ? <RevisitChips readingId={reading.id} /> : null,
        controls: <ReadingControls readingId={reading.id} />,
      }}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await params;
  return { title: 'Reading' };
}
