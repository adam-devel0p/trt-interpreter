import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getInterpretationState, listSafetyFlags } from '@/db/queries/interpretations';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { getReading } from '@/db/queries/readings';
import { selectDepth } from '@/domain/interpretation/depth';
import { isFutureFacing } from '@/domain/readings/futureFacing';
import { ReadingDetail } from '@/ui/components/reading-detail';
import { ReadingControls, FollowUpControl, NotesEditor, RevisitChips } from './controls';
import { InterpretationPanel } from './interpretation-panel';

export const dynamic = 'force-dynamic';

/**
 * Reading detail (§6.3). Reads through the query layer only; the client islands are bound to
 * server actions or route handlers. No model is called when this opens — a stored
 * interpretation renders from its row; a new one is requested by the panel after the save,
 * never by this page.
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
  const user = await requireUser();
  const client = await getSessionClient();
  const reading = await getReading(client, id);
  if (!reading) notFound();
  const [profile, interpretation, safetyFlags] = await Promise.all([
    getProfile(client, user.id),
    getInterpretationState(client, id),
    listSafetyFlags(client, 'reading', id),
  ]);
  const consent = profile ? hasAiConsent(profile) : false;
  const depth = profile
    ? selectDepth({
        ai_explanation_depth: profile.ai_explanation_depth,
        experience_level: profile.experience_level,
      })
    : null;
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
        interpretation: (
          <InterpretationPanel
            readingId={reading.id}
            metadataVersion={reading.metadata_version}
            cards={reading.cards.map((c) => ({
              position_index: c.position_index,
              positionName: c.position?.name ?? c.position_key,
              cardName: c.card.name,
              orientation: c.orientation,
            }))}
            consent={consent}
            collapsedByDefault={depth?.collapsedByDefault ?? false}
            initial={interpretation}
            safetyFlags={safetyFlags}
            autoStart={justSaved && consent && interpretation.latest === null}
          />
        ),
      }}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await params;
  return { title: 'Reading' };
}
