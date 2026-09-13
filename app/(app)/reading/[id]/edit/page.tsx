import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { listCards } from '@/db/queries/decks';
import { getReading, listRecentCardIds } from '@/db/queries/readings';
import { PageHeader } from '@/ui/components/page-header';
import { EditReadingForm } from './edit-form';

export const metadata = { title: 'Edit reading' };
export const dynamic = 'force-dynamic';

/** Edit metadata and cards (§6.3 controls). Same deck and spread; cards replaced atomically. */
export default async function EditReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  await requireUser();
  const client = await getSessionClient();
  const reading = await getReading(client, id);
  if (!reading) notFound();
  const [cards, recentIds] = await Promise.all([
    listCards(client, reading.deck),
    listRecentCardIds(client, reading.deck.id),
  ]);
  return (
    <div data-deck={reading.deck.system}>
      <PageHeader
        title="Edit reading"
        description={`${reading.spread.name} · ${reading.deck.name}. Deck and spread stay as they were; to change those, log the reading again.`}
      />
      <EditReadingForm reading={reading} cards={cards} recentIds={recentIds} />
    </div>
  );
}
