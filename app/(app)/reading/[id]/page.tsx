import { notFound } from 'next/navigation';
import { ageBucketOf } from '@/domain/analytics/events';
import { track } from '@/analytics/track';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import Link from 'next/link';
import {
  currentOutcomes,
  listEventOptions,
  listLinksForObject,
  listReadingOutcomes,
  loadLinkedObjects,
} from '@/db/queries/events';
import { getInterpretationState, listSafetyFlags } from '@/db/queries/interpretations';
import { getReadingJourneys } from '@/db/queries/journeys';
import { getReadingMemory } from '@/db/queries/memory';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { countReadingDependents, getReading, listNoteRevisions } from '@/db/queries/readings';
import { selectDepth } from '@/domain/interpretation/depth';
import { isFutureFacing } from '@/domain/readings/futureFacing';
import { flag } from '@/flags';
import { NoteHistory } from '@/ui/components/note-history';
import { ReadingDetail } from '@/ui/components/reading-detail';
import { ReadingControls, FollowUpControl, NotesEditor, RevisitChips } from './controls';
import { InterpretationPanel } from './interpretation-panel';
import { JourneyPanel } from './journey-panel';
import { MemoryPanel } from './memory-panel';
import { OutcomePanel } from './outcome-panel';
import { ConnectionReview, type ConnectionItem } from '../../event/connection-review';
import { Button } from '@/ui/components/button';

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
  const [
    profile,
    interpretation,
    safetyFlags,
    revisions,
    dependents,
    memory,
    extractionFlag,
    shareFlag,
    journeys,
    outcomes,
    links,
    eventOptions,
  ] = await Promise.all([
    getProfile(client, user.id),
    getInterpretationState(client, id),
    listSafetyFlags(client, 'reading', id),
    listNoteRevisions(client, id),
    countReadingDependents(client, id),
    getReadingMemory(client, reading),
    flag('ai_extraction', { userId: user.id }),
    flag('share_cards', { userId: user.id }),
    getReadingJourneys(client, id),
    listReadingOutcomes(client, id),
    listLinksForObject(client, { type: 'reading', id }),
    listEventOptions(client),
  ]);
  const linked = await loadLinkedObjects(client, links);
  const linkItems: ConnectionItem[] = links.map((link) => {
    const e = linked.events.get(link.to_id);
    return { link, other: e ? { kind: 'event', ...e } : { kind: 'missing' } };
  });
  const current = currentOutcomes(outcomes);
  const openPossibilities = memory.predictions
    .filter((p) => !p.dismissed_at)
    .map((p) => ({ id: p.id, text: p.text, current: current.byPrediction.get(p.id) ?? null }));
  const consent = profile ? hasAiConsent(profile) : false;
  const depth = profile
    ? selectDepth({
        ai_explanation_depth: profile.ai_explanation_depth,
        experience_level: profile.experience_level,
      })
    : null;
  const justSaved = saved === '1';
  // §16 early value: a saved reading opened again (an age class, never a date or a word).
  if (!justSaved) track(user.id, 'reading_reopened', { age: ageBucketOf(reading.occurred_at) });
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
        history: revisions.length ? <NoteHistory revisions={revisions} /> : null,
        followUp: (
          <FollowUpControl
            readingId={reading.id}
            status={reading.follow_up_status}
            revisitAt={reading.revisit_at}
          />
        ),
        revisit: offerRevisit ? <RevisitChips readingId={reading.id} /> : null,
        controls: (
          <div className="flex flex-col gap-4">
            {shareFlag ? (
              <Button asChild variant="secondary" className="self-start">
                <Link href={`/reading/${reading.id}/share`}>Share as an image</Link>
              </Button>
            ) : null}
            <ReadingControls
              readingId={reading.id}
              summary={{
                cards: dependents.cards,
                hasNotes: !!reading.user_notes,
                interpretations: dependents.interpretations,
                revisions: dependents.revisions,
              }}
            />
          </div>
        ),
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
        outcomes: (
          <div className="flex flex-col gap-4">
            <OutcomePanel
              readingId={reading.id}
              current={current.reading}
              history={outcomes.filter((o) => o.prediction_id === null)}
              possibilities={openPossibilities}
              events={eventOptions}
            />
            <Button asChild variant="secondary" className="self-start">
              <Link href={`/event/new?reading=${reading.id}`}>Something happened about this</Link>
            </Button>
          </div>
        ),
        links: (
          <ConnectionReview
            items={linkItems}
            emptyText="No life events connected yet. When you log one that seems related, it will be suggested here with its reasons — and “Something happened about this” below links one directly."
          />
        ),
        journeys: (
          <JourneyPanel
            readingId={reading.id}
            memberships={journeys.memberships}
            options={journeys.options}
          />
        ),
        connections: (
          <MemoryPanel
            readingId={reading.id}
            initial={memory}
            enabled={consent && extractionFlag}
            expectExtraction={justSaved || memory.stale}
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
