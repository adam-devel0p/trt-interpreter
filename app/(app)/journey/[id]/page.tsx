import Link from 'next/link';
import { track } from '@/analytics/track';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { paywallOffer } from '@/billing/offer';
import {
  currentOutcomes,
  listLinksForObjects,
  listOutcomesForReadings,
  loadLinkedObjects,
} from '@/db/queries/events';
import {
  getJourney,
  listJourneys,
  listMergedInto,
  type JourneyMemberView,
} from '@/db/queries/journeys';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { getJourneyNarrative, getJourneySummary } from '@/db/queries/summaries';
import { SummaryView } from '@/ui/components/summary-view';
import { notePaywallViewedAction, startCheckoutAction } from '../../billing/checkout-actions';
import { NarrativeControls, SummaryControls } from '../../retrospective/controls';
import { OUTCOME_LABEL, OUTCOME_SHORT } from '@/domain/outcomes/followUp';
import { ConnectionReview, type ConnectionItem } from '../../event/connection-review';
import { journalHref } from '@/domain/journal/filters';
import { narrativeHeader } from '@/domain/journeys/narrative';
import { recurringSymbols } from '@/domain/journeys/symbols';
import { buildTimeline, isOpenLoop, type TimelineEntry } from '@/domain/journeys/timeline';
import { Button } from '@/ui/components/button';
import { JourneyTimeline } from '@/ui/components/journey-timeline';
import { flag } from '@/flags';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { RecurringSymbols } from '@/ui/components/recurring-symbols';
import { ThemeProgression } from '@/ui/components/theme-progression';
import { SuggestedJourneyCard } from '../suggested-card';
import {
  DeleteControl,
  MemberControls,
  MergeControl,
  MergeUndoNotice,
  PendingMemberControls,
  RenameControl,
  SplitControl,
  StatusControl,
  UndoBar,
  UndoProvider,
} from './controls';

export const dynamic = 'force-dynamic';

/**
 * Journey detail (spec §6.5 — the centrepiece). The sections in the specified order, each
 * with a real empty state: narrative header (the stored `journey_narratives` sentence since
 * Phase 10, the deterministic counts beneath or instead), timeline, theme progression, the
 * summary so far (10), recurring symbols (contextual since 10), open loops, confirmed
 * outcomes (08), possible connections (08), ask (09). Everything renders from stored rows plus pure functions in
 * `src/domain/journeys`; opening this page makes zero model calls. Every card is shown under
 * its own deck's name — a Thoth card is never rendered as its RWS cousin (§6.7).
 */
export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  const client = await getSessionClient();
  const [detail, askEnabled, summariesEnabled, profile] = await Promise.all([
    getJourney(client, id),
    flag('ask_my_history', { userId: user.id }),
    flag('period_summaries', { userId: user.id }),
    getProfile(client, user.id),
  ]);
  if (!detail) notFound();
  const { journey, members, pending, events, pendingEvents, progression } = detail;

  if (detail.merged_into) {
    return (
      <>
        <PageHeader eyebrow="Journey" title={journey.title} />
        <p className="text-sm text-fg-muted">
          Merged into{' '}
          <Link
            href={`/journey/${detail.merged_into.id}`}
            className="text-accent underline underline-offset-4"
          >
            {detail.merged_into.title}
          </Link>
          . Undo from that page.
        </p>
      </>
    );
  }

  const memberReadingIds = members.map((m) => m.reading.id);
  const memberEventIds = events.map((e) => e.event.id);
  const [others, merged, outcomeRows, linkRows, narrative, journeySummary] = await Promise.all([
    listJourneys(client),
    listMergedInto(client, id),
    listOutcomesForReadings(client, memberReadingIds),
    listLinksForObjects(client, { readings: memberReadingIds, events: memberEventIds }),
    getJourneyNarrative(client, id),
    getJourneySummary(client, id),
  ]);
  const canGenerate = !!profile && hasAiConsent(profile) && summariesEnabled;
  // Writing the header or a summary is premium (§14); the stored ones and the timeline are not.
  const offer = canGenerate ? await paywallOffer(user.id, 'summaries') : null;
  const premium =
    offer && !offer.allowed
      ? {
          offer,
          context: `A written summary of “${journey.title}”, each claim traced to its entries.`,
          stillWorks:
            'The timeline, progression, symbols and connections on this page come from what you recorded and stay here on any plan.',
          returnTo: `/journey/${journey.id}`,
          action: startCheckoutAction,
          onViewed: notePaywallViewedAction,
        }
      : null;
  track(user.id, 'journey_viewed', { members: members.length + events.length });
  const linked = await loadLinkedObjects(client, linkRows);
  const titleOf = (m: JourneyMemberView) =>
    m.reading.is_open_reflection ? 'Open reflection' : (m.reading.question ?? 'Reading');
  const titles = new Map(members.map((m) => [m.reading.id, titleOf(m)]));

  const entries: TimelineEntry[] = members.map((m) => ({
    kind: 'reading',
    id: m.reading.id,
    at: m.reading.occurred_at,
    question: m.reading.question,
    isOpenReflection: m.reading.is_open_reflection,
    deck: { system: m.reading.deck.system, name: m.reading.deck.name },
    spread: m.reading.spread.name,
    cards: m.reading.cards.map((c) => ({
      cardId: c.card.id,
      name: c.card.name,
      orientation: c.orientation,
      positionName: m.reading.positions[c.position_index]?.name ?? null,
    })),
    followUpStatus: m.reading.follow_up_status,
    revisitAt: m.reading.revisit_at,
    membership: { state: m.state as 'auto' | 'confirmed', reasons: m.reasons },
  }));
  // Phase 08: events and the current outcome of each reading interleave with the readings.
  for (const e of events)
    entries.push({
      kind: 'event',
      id: e.event.id,
      at: `${e.event.occurred_on}T12:00:00.000Z`,
      description: e.event.description,
    });
  const outcomesByReading = new Map<string, ReturnType<typeof currentOutcomes>>();
  for (const rid of memberReadingIds)
    outcomesByReading.set(rid, currentOutcomes(outcomeRows.filter((o) => o.reading_id === rid)));
  const confirmedOutcomes = memberReadingIds
    .map((rid) => ({ readingId: rid, outcome: outcomesByReading.get(rid)!.reading }))
    .filter((x): x is { readingId: string; outcome: NonNullable<typeof x.outcome> } => !!x.outcome);
  for (const { readingId, outcome } of confirmedOutcomes)
    entries.push({
      kind: 'outcome',
      id: outcome.id,
      at: outcome.user_confirmed_at,
      description: `${OUTCOME_LABEL[outcome.status]} — ${titles.get(readingId) ?? 'reading'}`,
      status: outcome.status,
    });
  const groups = buildTimeline(entries);
  const connections: ConnectionItem[] = linkRows.map((link) => {
    const inJourneyReading = memberReadingIds.includes(link.from_id);
    // Show the side that is *not* already a member, so the card adds information.
    if (inJourneyReading) {
      const e = linked.events.get(link.to_id);
      return { link, other: e ? { kind: 'event', ...e } : { kind: 'missing' } };
    }
    const r = linked.readings.get(link.from_id);
    return { link, other: r ? { kind: 'reading', ...r } : { kind: 'missing' } };
  });
  const possibleConnections = connections.filter((c) => c.link.state !== 'confirmed');
  const confirmedConnections = connections.filter((c) => c.link.state === 'confirmed');
  const memberById = new Map(members.map((m) => [m.reading.id, m]));

  const symbols = recurringSymbols(
    members.map((m) => ({
      id: m.reading.id,
      occurredAt: m.reading.occurred_at,
      deckSystem: m.reading.deck.system,
      deckName: m.reading.deck.name,
      cards: m.reading.cards.map((c) => ({
        cardId: c.card.id,
        name: c.card.name,
        suit: c.card.suit,
        suitLabel: c.card.suit_label,
        positionName: m.reading.positions[c.position_index]?.name ?? null,
      })),
      themes: m.themes.map((t) => ({ slug: t.slug, label: t.label })),
    })),
    {
      events: events.map((e) => ({
        id: e.event.id,
        occurredOn: e.event.occurred_on,
        description: e.event.description,
      })),
      confirmedLinks: linkRows
        .filter(
          (l) => l.state === 'confirmed' && l.from_type === 'reading' && l.to_type === 'life_event',
        )
        .map((l) => ({ readingId: l.from_id, eventId: l.to_id })),
    },
  );
  const openLoops = members.filter((m) =>
    isOpenLoop({ followUpStatus: m.reading.follow_up_status, revisitAt: m.reading.revisit_at }),
  );
  const earliest = [
    ...members.map((m) => m.reading.occurred_at),
    ...events.map((e) => `${e.event.occurred_on}T12:00:00.000Z`),
  ].sort()[0];
  const plainHeader = narrativeHeader({
    readings: members.length,
    events: events.length,
    confirmedOutcomes: confirmedOutcomes.length,
    openLoops: openLoops.length,
    deckSystems: new Set(members.map((m) => m.reading.deck.system)).size,
    since: earliest ?? null,
  });
  // Phase 10: the stored narrative sentence leads when one exists (never generated here);
  // the honest counts stay beneath it. Its sources link to the entries it rests on.
  const narrativeSources = (narrative?.source_object_ids ?? []).filter(
    (oid) => titles.has(oid) || events.some((e) => e.event.id === oid),
  );
  const header = narrative ? (
    <span data-testid="journey-narrative" data-stale={narrative.stale_at ? 'true' : 'false'}>
      <span className="block">{narrative.sentence}</span>
      {narrative.progression.length ? (
        <span className="mt-1 block text-xs text-fg-muted">
          {narrative.progression.join(' → ')}
        </span>
      ) : null}
      <span className="mt-1 block text-xs text-fg-muted">
        {plainHeader}
        {narrativeSources.length ? (
          <>
            {' '}
            Rests on{' '}
            {narrativeSources.map((oid, i) => (
              <span key={oid}>
                {i > 0 ? ', ' : ''}
                <Link
                  href={titles.has(oid) ? `/reading/${oid}` : `/event/${oid}`}
                  className="underline underline-offset-4"
                >
                  {titles.get(oid) ?? events.find((e) => e.event.id === oid)?.event.description}
                </Link>
              </span>
            ))}
            .
          </>
        ) : null}
        {narrative.stale_at ? ' An entry it rested on was deleted since.' : ''}
      </span>
    </span>
  ) : (
    plainHeader
  );
  const steps = progression
    .filter((s) => s.source_object_ids.length >= 2)
    .map((s) => ({
      id: s.id,
      label: s.theme.label,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      sources: s.source_object_ids
        .map((oid) => memberById.get(oid))
        .filter((m): m is JourneyMemberView => !!m)
        .map((m) => ({ id: m.reading.id, title: titleOf(m), at: m.reading.occurred_at })),
    }));
  const isSuggestion = journey.status === 'suggested' && !journey.dismissed_at;

  return (
    <article className="pb-8">
      <PageHeader
        eyebrow={
          journey.status === 'suggested'
            ? 'Possibly a journey'
            : journey.status === 'closed'
              ? 'Closed journey'
              : journey.status === 'dormant'
                ? 'Journey · quiet lately'
                : 'Journey'
        }
        title={journey.title}
        description={header}
        action={
          <Link href="/journey" className="text-sm text-accent underline underline-offset-4">
            All
          </Link>
        }
      />
      {journey.dismissed_at ? (
        <p className="mb-5 rounded-card bg-surface px-4 py-3 text-sm text-fg-muted hairline">
          You dismissed this suggestion. It stays here for reference and will not be offered again.
        </p>
      ) : null}
      {isSuggestion ? (
        <div className="mb-6">
          <SuggestedJourneyCard journey={{ ...journey, member_count: members.length }} compact />
        </div>
      ) : null}
      <MergeUndoNotice merged={merged.map((m) => ({ id: m.id, title: m.title }))} />
      {canGenerate && members.length + events.length >= 3 ? (
        <div className="mb-4">
          <NarrativeControls journeyId={journey.id} canGenerate={canGenerate} premium={premium} />
        </div>
      ) : null}
      {journey.reasons.length && journey.created_by !== 'user' ? (
        <details className="mb-6 text-sm text-fg-muted">
          <summary className="min-h-11 cursor-pointer py-2">
            Why these readings were gathered
          </summary>
          <ul className="list-disc pl-5">
            {journey.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <Section id="timeline" title="Timeline">
        <UndoProvider>
          <UndoBar />
          {groups.length === 0 ? (
            <Empty>No readings here yet. Add one from any reading’s Connections section.</Empty>
          ) : (
            <JourneyTimeline
              groups={groups}
              renderExtra={(e) => {
                const m = memberById.get(e.id);
                return m ? (
                  <MemberControls member={{ id: m.id, state: m.state }} label={titleOf(m)} />
                ) : null;
              }}
            />
          )}
        </UndoProvider>
        {pending.length || pendingEvents.length ? (
          <div className="mt-4 rounded-card border border-dashed border-hairline-strong bg-surface-ai px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
              Might belong here
            </p>
            <ul className="mt-2 flex flex-col gap-3">
              {pendingEvents.map((m) => (
                <li key={m.id} className="text-sm">
                  <Link
                    href={`/event/${m.event.id}`}
                    className="font-serif text-base hover:underline"
                  >
                    {m.event.description}
                  </Link>
                  <span className="text-fg-muted">
                    {' '}
                    · <LocalTime iso={`${m.event.occurred_on}T12:00:00Z`} dateOnly /> · life event
                  </span>
                  {m.reasons.length ? (
                    <p className="mt-0.5 text-xs text-fg-muted">{m.reasons.join('. ')}.</p>
                  ) : null}
                  <div className="mt-1.5">
                    <PendingMemberControls memberId={m.id} />
                  </div>
                </li>
              ))}
              {pending.map((m) => (
                <li key={m.id} className="text-sm" data-deck={m.reading.deck.system}>
                  <Link
                    href={`/reading/${m.reading.id}`}
                    className="font-serif text-base hover:underline"
                  >
                    {titleOf(m)}
                  </Link>
                  <span className="text-fg-muted">
                    {' '}
                    · <LocalTime iso={m.reading.occurred_at} dateOnly /> · {m.reading.deck.name}
                  </span>
                  {m.reasons.length ? (
                    <p className="mt-0.5 text-xs text-fg-muted">{m.reasons.join('. ')}.</p>
                  ) : null}
                  <div className="mt-1.5">
                    <PendingMemberControls memberId={m.id} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section
        id="progression"
        title="Theme progression"
        lead="How the themes moved over time, from the readings themselves."
      >
        {steps.length === 0 ? (
          <Empty>
            {members.length < 2
              ? 'Once two or more readings are here, the themes they share will line up in order.'
              : 'No theme has shown up in two readings of the same period yet. This fills in as the journey grows.'}
          </Empty>
        ) : (
          <ThemeProgression steps={steps} />
        )}
      </Section>

      <Section
        id="summary"
        title="Summary so far"
        lead="Written by the app from this journey’s entries, every line traceable. Not a record of anything."
      >
        {journeySummary && !journeySummary.dismissed_at ? (
          <SummaryView
            id={journeySummary.id}
            headline={journeySummary.summary}
            highlights={journeySummary.highlights}
            titles={{
              get(oid) {
                const t = titles.get(oid);
                if (t) return { title: t, href: `/reading/${oid}` };
                const e = events.find((x) => x.event.id === oid);
                return e ? { title: e.event.description, href: `/event/${oid}` } : undefined;
              },
            }}
            stale={!!journeySummary.stale_at}
            meta={
              <>
                Written <LocalTime iso={journeySummary.generated_at} dateOnly /> from{' '}
                {journeySummary.object_count}{' '}
                {journeySummary.object_count === 1 ? 'entry' : 'entries'}
              </>
            }
          />
        ) : (
          <Empty>
            {journeySummary?.dismissed_at
              ? 'You dismissed this summary. The sections below are unchanged.'
              : members.length + events.length < 5
                ? 'Once five entries are here, a summary can be written from them.'
                : canGenerate
                  ? 'No summary written yet. It follows the journey as it grows.'
                  : 'No summary here. The sections below come straight from your entries.'}
          </Empty>
        )}
        {members.length + events.length >= 5 ? (
          <div className="mt-3">
            <SummaryControls
              summaryId={journeySummary?.id ?? null}
              dismissed={!!journeySummary?.dismissed_at}
              target={{ kind: 'journey', journeyId: journey.id }}
              canGenerate={canGenerate}
              premium={premium}
            />
          </div>
        ) : null}
      </Section>

      <Section
        id="symbols"
        title="Recurring symbols"
        lead="Cards, suits and themes that keep coming back — when, around what, each under its own deck’s name. Three readings make a pattern; two are two."
      >
        {symbols.length === 0 ? (
          <Empty>
            Nothing has recurred yet. A card or suit that turns up in two readings here will be
            listed with where it appeared.
          </Empty>
        ) : (
          <RecurringSymbols symbols={symbols} titles={titles} />
        )}
      </Section>

      <Section id="open-loops" title="Open loops" lead="Readings still waiting on what happened.">
        {openLoops.length === 0 ? (
          <Empty>Nothing open. Every reading here has an answer or a closed follow-up.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {openLoops.map((m) => (
              <li key={m.id} data-deck={m.reading.deck.system}>
                <Link
                  href={`/reading/${m.reading.id}`}
                  className="block rounded-card border-l-2 border-accent bg-surface px-4 py-3 hairline hover:bg-surface-2"
                >
                  <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    <LocalTime iso={m.reading.occurred_at} dateOnly />
                    <span className="tracking-normal normal-case"> · {m.reading.deck.name}</span>
                  </p>
                  <p className="mt-1 font-serif text-lg leading-snug">{titleOf(m)}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {m.reading.revisit_at && Date.parse(m.reading.revisit_at) <= Date.now()
                      ? 'The revisit date has passed. Say what happened when you know.'
                      : 'Not resolved yet.'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="outcomes"
        title="Confirmed outcomes"
        lead="What you recorded actually happened — your word, never a model’s."
      >
        {confirmedOutcomes.length === 0 && confirmedConnections.length === 0 ? (
          <Empty>
            When you record what actually happened, confirmed outcomes will sit here with the
            readings they answer.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {confirmedOutcomes.map(({ readingId, outcome }) => (
              <li key={outcome.id} className="rounded-card bg-surface px-4 py-3 text-sm hairline">
                <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                  <LocalTime iso={outcome.user_confirmed_at} dateOnly />
                  <span className="tracking-normal normal-case">
                    {' '}
                    · {OUTCOME_SHORT[outcome.status]}
                  </span>
                </p>
                <Link
                  href={`/reading/${readingId}`}
                  className="mt-1 block font-serif text-base hover:underline"
                >
                  {titles.get(readingId) ?? 'Reading'}
                </Link>
                {outcome.note ? <p className="mt-1 whitespace-pre-wrap">{outcome.note}</p> : null}
                {outcome.event ? (
                  <p className="mt-1 text-fg-muted">
                    Event:{' '}
                    <Link
                      href={`/event/${outcome.event.id}`}
                      className="text-accent underline underline-offset-4"
                    >
                      {outcome.event.description}
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
            {confirmedConnections.length ? (
              <li>
                <p className="mt-2 mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
                  Connections you confirmed
                </p>
                <ConnectionReview items={confirmedConnections} />
              </li>
            ) : null}
          </ul>
        )}
      </Section>

      <Section
        id="connections"
        title="Possible connections"
        lead="Inferred, never certain — each with its evidence. You decide."
      >
        <ConnectionReview
          items={possibleConnections}
          emptyText="Nothing suggested right now. When a life event seems to relate to one of these readings, the possible link will be offered here with its reasons."
        />
      </Section>

      <Section id="ask" title="Ask about this journey">
        {askEnabled ? (
          <Button variant="secondary" asChild>
            <Link href={`/ask?journey=${journey.id}`}>Ask about this journey</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled aria-disabled="true">
            Ask about this journey · not switched on yet
          </Button>
        )}
        <p className="mt-2 text-sm text-fg-muted">
          Questions answered from this journey’s readings, events and connections only, with the
          entries cited.
        </p>
      </Section>

      <Section id="manage" title="Manage">
        <div className="flex flex-col gap-6">
          <RenameControl journey={journey} />
          <StatusControl journey={journey} />
          <p className="text-sm">
            <Link
              href={journalHref({ journey: journey.id })}
              className="text-accent underline underline-offset-4"
            >
              See these readings in the journal
            </Link>
          </p>
          <MergeControl
            journey={journey}
            others={others
              .filter((o) => o.id !== journey.id && !o.dismissed_at && o.status !== 'closed')
              .map((o) => ({ id: o.id, title: o.title }))}
          />
          <SplitControl
            journey={journey}
            members={members.map((m) => ({
              id: m.id,
              title: titleOf(m),
              at: m.reading.occurred_at,
            }))}
          />
          <DeleteControl journey={journey} memberCount={members.length} />
        </div>
      </Section>
    </article>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="mt-8" data-section={id}>
      <h2 id={`${id}-h`} className="mb-1 font-serif text-xl">
        {title}
      </h2>
      {lead ? <p className="mb-3 text-sm text-fg-muted">{lead}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-sm text-fg-muted">
      {children}
    </p>
  );
}

export async function generateMetadata() {
  return { title: 'Journey' };
}
