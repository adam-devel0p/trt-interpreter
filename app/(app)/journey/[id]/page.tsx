import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import {
  getJourney,
  listJourneys,
  listMergedInto,
  type JourneyMemberView,
} from '@/db/queries/journeys';
import { journalHref } from '@/domain/journal/filters';
import { narrativeHeader } from '@/domain/journeys/narrative';
import { recurringSymbols } from '@/domain/journeys/symbols';
import { buildTimeline, isOpenLoop, type TimelineEntry } from '@/domain/journeys/timeline';
import { Button } from '@/ui/components/button';
import { JourneyTimeline } from '@/ui/components/journey-timeline';
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
 * Journey detail (spec §6.5 — the centrepiece). Eight sections in the specified order, each
 * with a real empty state: narrative header (deterministic until Phase 10), timeline,
 * theme progression, recurring symbols, open loops, confirmed outcomes (08), possible
 * connections (08), ask (09). Everything renders from stored rows plus pure functions in
 * `src/domain/journeys`; opening this page makes zero model calls. Every card is shown under
 * its own deck's name — a Thoth card is never rendered as its RWS cousin (§6.7).
 */
export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  await requireUser();
  const client = await getSessionClient();
  const detail = await getJourney(client, id);
  if (!detail) notFound();
  const { journey, members, pending, progression } = detail;

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

  const [others, merged] = await Promise.all([listJourneys(client), listMergedInto(client, id)]);
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
  const groups = buildTimeline(entries);
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
  );
  const openLoops = members.filter((m) =>
    isOpenLoop({ followUpStatus: m.reading.follow_up_status, revisitAt: m.reading.revisit_at }),
  );
  const header = narrativeHeader({
    readings: members.length,
    confirmedOutcomes: 0,
    openLoops: openLoops.length,
    deckSystems: new Set(members.map((m) => m.reading.deck.system)).size,
    since: members.length ? members[members.length - 1]!.reading.occurred_at : null,
  });
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
        {pending.length ? (
          <div className="mt-4 rounded-card border border-dashed border-hairline-strong bg-surface-ai px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
              Might belong here
            </p>
            <ul className="mt-2 flex flex-col gap-3">
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
        id="symbols"
        title="Recurring symbols"
        lead="Cards, suits and themes that keep coming back — each under its own deck’s name."
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

      <Section id="outcomes" title="Confirmed outcomes">
        <Empty>
          When you record what actually happened, confirmed outcomes will sit here with the readings
          they answer.
        </Empty>
      </Section>

      <Section
        id="connections"
        title="Possible connections"
        lead="Inferred, never certain — each with its evidence."
      >
        <Empty>
          Once life events can be recorded, possible links between them and these readings will be
          suggested here, labelled as suggestions.
        </Empty>
      </Section>

      <Section id="ask" title="Ask about this journey">
        <Button variant="secondary" disabled aria-disabled="true">
          Ask about this journey · coming soon
        </Button>
        <p className="mt-2 text-sm text-fg-muted">
          Questions answered from these readings only, with the entries cited.
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
