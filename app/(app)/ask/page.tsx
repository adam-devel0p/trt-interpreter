import Link from 'next/link';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { listAsks } from '@/db/queries/asks';
import { listJourneys } from '@/db/queries/journeys';
import { listEntities } from '@/db/queries/memory';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { ASK_QUESTION_MAX, EXAMPLE_QUESTIONS, type AskScope } from '@/domain/retrieval/query';
import { flag } from '@/flags';
import { EmptyState } from '@/ui/components/empty-state';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { AskComposer } from './ask-composer';

export const metadata = { title: 'Ask my history' };
export const dynamic = 'force-dynamic';

/**
 * Ask My History (spec §6.6). The composer, scope options built from the user's own
 * journeys and entities, and the stored asks below it — each a page of its own that makes
 * no model call. Gated by the `ask_my_history` flag and AI consent; both states are plain
 * sentences, never a dead end.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ journey?: string; entity?: string; q?: string }>;
}) {
  const user = await requireUser();
  const client = await getSessionClient();
  const params = await searchParams;
  const [enabled, profile] = await Promise.all([
    flag('ask_my_history', { userId: user.id }),
    getProfile(client, user.id),
  ]);
  if (!enabled) {
    return (
      <>
        <PageHeader title="Ask my history" />
        <EmptyState
          title="Not switched on for this account yet"
          description="Ask my history answers plain-language questions from your own entries, with sources. It is being rolled out gradually; your journal, journeys and connections work exactly as before."
        />
      </>
    );
  }
  if (!profile || !hasAiConsent(profile)) {
    return (
      <>
        <PageHeader title="Ask my history" />
        <EmptyState
          title="AI processing is off"
          description="Ask my history sends a compact, bounded set of your entries to a model to compose an answer. Switch AI processing on in your profile to use it; everything else works without it."
          action={
            <Link href="/profile" className="text-accent underline underline-offset-4">
              Open profile
            </Link>
          }
        />
      </>
    );
  }

  const [journeys, entities, recent] = await Promise.all([
    listJourneys(client),
    listEntities(client),
    listAsks(client, 20),
  ]);
  const journeyOptions = journeys
    .filter((j) => !j.dismissed_at && !j.merged_into_id)
    .map((j) => ({ id: j.id, label: j.title }));
  const entityOptions = entities.map((e) => ({ id: e.id, label: e.canonical_label }));
  const uuid = z.string().uuid();
  const initialScope: AskScope =
    params.journey &&
    uuid.safeParse(params.journey).success &&
    journeyOptions.some((j) => j.id === params.journey)
      ? { kind: 'journey', journeyId: params.journey }
      : params.entity &&
          uuid.safeParse(params.entity).success &&
          entityOptions.some((e) => e.id === params.entity)
        ? { kind: 'entity', entityId: params.entity }
        : { kind: 'all' };
  const lockedJourney =
    initialScope.kind === 'journey'
      ? journeyOptions.find((j) => j.id === initialScope.journeyId)
      : null;

  return (
    <>
      <PageHeader
        title={lockedJourney ? `Ask about “${lockedJourney.label}”` : 'Ask my history'}
        description={
          lockedJourney
            ? 'Answers come only from this journey’s readings, events and connections.'
            : 'Questions about your own readings, answered from your own entries — every claim with its source.'
        }
      />
      <AskComposer
        examples={EXAMPLE_QUESTIONS}
        journeys={journeyOptions}
        entities={entityOptions}
        initialScope={initialScope}
        initialQuestion={params.q?.slice(0, ASK_QUESTION_MAX)}
        lockScope={Boolean(lockedJourney)}
      />
      {recent.length ? (
        <section aria-labelledby="asks-h" className="mt-10">
          <h2 id="asks-h" className="mb-3 font-serif text-xl">
            Earlier questions
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/ask/${a.id}`}
                  className="block rounded-card bg-surface p-3 hairline hover:bg-surface-2"
                >
                  <p className="font-serif text-base leading-snug">{a.question}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    <LocalTime iso={a.created_at} dateOnly />
                    {' · '}
                    {a.status === 'complete'
                      ? a.evidence_sufficient
                        ? `${a.citations?.length ?? 0} ${a.citations?.length === 1 ? 'source' : 'sources'}`
                        : 'not enough evidence'
                      : a.status === 'failed'
                        ? 'did not complete'
                        : 'in progress'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
