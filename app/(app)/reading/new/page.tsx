import { getSessionClient, requireUser } from '@/auth/session';
import { listCards, listDecks, listSpreads } from '@/db/queries/decks';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { getServerDraft, listRecentCardIds } from '@/db/queries/readings';
import { ReadingFlow, type FlowDeck } from './reading-flow';

export const metadata = { title: 'New reading' };
export const dynamic = 'force-dynamic';

/**
 * The reading loop (§6.2). Everything the flow needs is loaded once here — both decks with
 * their 78 cards each (so switching deck mid-flow is instant and deck-scoped by construction),
 * built-in + custom spreads, profile defaults, recent cards per deck and any server-side
 * draft — then handed to the client wizard. No model is involved anywhere in this tree.
 */
export default async function NewReadingPage() {
  const user = await requireUser();
  const client = await getSessionClient();
  const [decks, spreads, profile, serverDraft] = await Promise.all([
    listDecks(client),
    listSpreads(client),
    getProfile(client, user.id),
    getServerDraft(client, user.id),
  ]);
  const flowDecks: FlowDeck[] = await Promise.all(
    decks.map(async (deck) => {
      const [cards, recentIds] = await Promise.all([
        listCards(client, deck),
        listRecentCardIds(client, deck.id),
      ]);
      return { deck, cards, recentIds };
    }),
  );
  const usage = profile?.usage_style ?? null;
  return (
    <ReadingFlow
      decks={flowDecks}
      spreads={spreads}
      defaults={{
        deckId: profile?.default_deck_id ?? null,
        source: usage === 'physical' ? 'physical' : 'digital',
        useReversals: profile?.use_reversals ?? true,
      }}
      serverDraft={serverDraft}
      repeatCheck={profile ? hasAiConsent(profile) : false}
    />
  );
}
