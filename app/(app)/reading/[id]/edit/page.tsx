import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { listCards, listDecks, listSpreads } from '@/db/queries/decks';
import { getInterpretationState } from '@/db/queries/interpretations';
import { getReading, listRecentCardIds } from '@/db/queries/readings';
import { PageHeader } from '@/ui/components/page-header';
import { EditReadingForm } from './edit-form';

export const metadata = { title: 'Edit reading' };
export const dynamic = 'force-dynamic';

/**
 * Edit everything the user set (§6.3 controls): question, date, life area, spread, deck,
 * cards and orientations. Both decks' cards ship so a deck switch is instant, as in the flow.
 */
export default async function EditReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  await requireUser();
  const client = await getSessionClient();
  const reading = await getReading(client, id);
  if (!reading) notFound();
  const [decks, spreads, recentIds, interpretation] = await Promise.all([
    listDecks(client),
    listSpreads(client),
    listRecentCardIds(client, reading.deck.id),
    getInterpretationState(client, id),
  ]);
  const cardsByDeck = Object.fromEntries(
    await Promise.all(decks.map(async (d) => [d.id, await listCards(client, d)] as const)),
  );
  return (
    <div data-deck={reading.deck.system}>
      <PageHeader
        title="Edit reading"
        description="Change what you asked, when, which spread and deck, and the cards. Your notes stay as they are."
      />
      <EditReadingForm
        reading={reading}
        decks={decks}
        spreads={spreads}
        cardsByDeck={cardsByDeck}
        recentIds={recentIds}
        hasInterpretation={interpretation.current !== null}
      />
    </div>
  );
}
