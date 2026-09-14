import Link from 'next/link';
import { track } from '@/analytics/track';
import { notFound } from 'next/navigation';
import { getSessionClient, requireUser } from '@/auth/session';
import { paywallOffer } from '@/billing/offer';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { loadRetrospective } from '@/db/queries/retrospective';
import { getSummaryForPeriod } from '@/db/queries/summaries';
import { OUTCOME_LABEL, OUTCOME_SHORT } from '@/domain/outcomes/followUp';
import { isOpenLoop } from '@/domain/journeys/timeline';
import { patterns, recurringSymbols } from '@/domain/journeys/symbols';
import { summaryFloor } from '@/domain/summaries/floors';
import { parsePeriodKey, periodLabel } from '@/domain/summaries/periods';
import { flag } from '@/flags';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { RecurringSymbols } from '@/ui/components/recurring-symbols';
import { SummaryView } from '@/ui/components/summary-view';
import { notePaywallViewedAction, startCheckoutAction } from '../../billing/checkout-actions';
import { SummaryControls } from '../controls';

export const dynamic = 'force-dynamic';

/**
 * The monthly (or weekly) retrospective (spec §15.2): built from user-confirmed data first —
 * confirmed life events, outcomes recorded, journeys that moved, open loops — with the
 * recurring symbols in context and, when one was generated and not dismissed, the summary
 * with every claim's basis and sources. Sections are navigable by heading; the one visual
 * has a text equivalent. Opening this page makes zero model calls; "Regenerate" is the
 * explicit exception and says so.
 */
export default async function RetrospectivePage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period: key } = await params;
  const period = parsePeriodKey(key);
  if (!period) notFound();
  const user = await requireUser();
  const client = await getSessionClient();
  const [data, summary, profile, flagOn, shareOn] = await Promise.all([
    loadRetrospective(client, period),
    getSummaryForPeriod(client, period.kind, period.start),
    getProfile(client, user.id),
    flag('period_summaries', { userId: user.id }),
    flag('share_cards', { userId: user.id }),
  ]);
  const total = data.readings.length + data.events.length;
  if (total < summaryFloor(period.kind)) notFound();
  const canGenerate = !!profile && hasAiConsent(profile) && flagOn;
  track(user.id, 'retrospective_viewed', { kind: period.kind });
  // Generation is premium (§14); the stored summary and everything below it are not.
  const offer = canGenerate ? await paywallOffer(user.id, 'summaries') : null;
  const premium =
    offer && !offer.allowed
      ? {
          offer,
          context: `A written summary of ${periodLabel(period)}, every claim traced to the entries below.`,
          stillWorks:
            'Everything on this page comes from what you recorded and stays here on any plan.',
          returnTo: `/retrospective/${period.key}`,
          action: startCheckoutAction,
          onViewed: notePaywallViewedAction,
        }
      : null;

  const titleOf = (r: { question: string | null; is_open_reflection: boolean }) =>
    r.is_open_reflection ? 'Open reflection' : (r.question ?? 'Reading');
  const readingTitles = new Map(data.readings.map((r) => [r.id, titleOf(r)]));
  const titles = {
    get(id: string) {
      const r = readingTitles.get(id);
      if (r) return { title: r, href: `/reading/${id}` };
      const e = data.events.find((x) => x.id === id);
      return e ? { title: e.description, href: `/event/${id}` } : undefined;
    },
  };
  const symbols = patterns(
    recurringSymbols(
      data.readings.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        deckSystem: r.deck.system,
        deckName: r.deck.name,
        cards: r.cards.map((c) => ({
          cardId: c.card.id,
          name: c.card.name,
          suit: c.card.suit,
          suitLabel: c.card.suit_label,
          positionName: r.positions[c.position_index]?.name ?? null,
        })),
        themes: r.themes.map((t) => ({ slug: t.slug, label: t.label })),
        journeys: r.journeys,
      })),
      {
        events: data.events.map((e) => ({
          id: e.id,
          occurredOn: e.occurred_on,
          description: e.description,
        })),
        confirmedLinks: data.confirmedLinks,
      },
    ),
  );
  const journeysMoved = new Map<
    string,
    { title: string; labels: string[]; sources: Set<string> }
  >();
  for (const s of data.steps) {
    const cur = journeysMoved.get(s.journey.id) ?? {
      title: s.journey.title,
      labels: [],
      sources: new Set(),
    };
    if (cur.labels[cur.labels.length - 1] !== s.label) cur.labels.push(s.label);
    for (const id of s.source_object_ids) cur.sources.add(id);
    journeysMoved.set(s.journey.id, cur);
  }
  const openLoops = data.readings.filter((r) =>
    isOpenLoop({ followUpStatus: r.follow_up_status, revisitAt: r.revisit_at }),
  );
  const label = periodLabel(period);

  return (
    <article className="pb-8">
      <PageHeader
        eyebrow={
          period.kind === 'monthly'
            ? 'Monthly retrospective'
            : period.kind === 'weekly'
              ? 'Weekly reflection'
              : 'A year'
        }
        title={label}
        description={`${data.readings.length} ${data.readings.length === 1 ? 'reading' : 'readings'}${data.events.length ? `, ${data.events.length} ${data.events.length === 1 ? 'life event' : 'life events'}` : ''}${data.outcomes.length ? `, ${data.outcomes.length} ${data.outcomes.length === 1 ? 'outcome' : 'outcomes'} recorded` : ''}.`}
        action={
          <span className="flex gap-3">
            {shareOn && period.kind === 'monthly' ? (
              <Link
                href={`/retrospective/${period.key}/share`}
                className="text-sm text-accent underline underline-offset-4"
              >
                Share
              </Link>
            ) : null}
            <Link
              href="/retrospective"
              className="text-sm text-accent underline underline-offset-4"
            >
              All
            </Link>
          </span>
        }
      />

      <Section
        id="summary"
        title="In a few sentences"
        lead="Written by the app from the entries below, every line traceable. Not a record of anything."
      >
        {summary && !summary.dismissed_at ? (
          <SummaryView
            id={summary.id}
            headline={summary.summary}
            highlights={summary.highlights}
            titles={titles}
            stale={!!summary.stale_at}
            meta={
              <>
                Written <LocalTime iso={summary.generated_at} dateOnly /> from{' '}
                {summary.object_count} {summary.object_count === 1 ? 'entry' : 'entries'}
              </>
            }
          />
        ) : (
          <Empty>
            {summary?.dismissed_at
              ? 'You dismissed the summary for this period. Everything below is still here.'
              : canGenerate
                ? 'No summary has been written for this period yet. The sections below stand on their own; a summary can be written from them.'
                : 'No summary here. Everything below comes straight from what you recorded.'}
          </Empty>
        )}
        <div className="mt-3">
          <SummaryControls
            summaryId={summary?.id ?? null}
            dismissed={!!summary?.dismissed_at}
            target={{ kind: period.kind, periodKey: period.key }}
            canGenerate={canGenerate}
            premium={premium}
          />
        </div>
      </Section>

      <Section
        id="recurring"
        title="What kept coming back"
        lead="Cards and themes in three or more readings this period — when, around what, and whether you confirmed a connection."
      >
        {symbols.length === 0 ? (
          <Empty>
            No card, suit or theme appeared in three readings this period. Two appearances are two
            appearances, not a pattern.
          </Empty>
        ) : (
          <RecurringSymbols
            symbols={symbols}
            titles={readingTitles}
            span={{ start: `${period.start}T00:00:00Z`, end: `${period.end}T23:59:59Z` }}
          />
        )}
      </Section>

      <Section id="events" title="What happened" lead="Life events you logged — your word.">
        {data.events.length === 0 ? (
          <Empty>No life events logged this period.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/event/${e.id}`}
                  className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
                >
                  <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    <LocalTime iso={`${e.occurred_on}T12:00:00Z`} dateOnly />
                  </p>
                  <p className="mt-1 font-serif text-base leading-snug">{e.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="outcomes"
        title="Outcomes you recorded"
        lead="What you said actually happened, on the readings that asked."
      >
        {data.outcomes.length === 0 ? (
          <Empty>No outcomes recorded this period.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.outcomes.map((o) => (
              <li key={o.id} className="rounded-card bg-surface px-4 py-3 text-sm hairline">
                <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                  <LocalTime iso={o.user_confirmed_at} dateOnly />
                  <span className="tracking-normal normal-case"> · {OUTCOME_SHORT[o.status]}</span>
                </p>
                {o.reading ? (
                  <Link
                    href={`/reading/${o.reading.id}`}
                    className="mt-1 block font-serif text-base hover:underline"
                  >
                    {titleOf(o.reading)}
                  </Link>
                ) : null}
                <p className="mt-1 text-fg-muted">
                  {OUTCOME_LABEL[o.status]}
                  {o.note ? ` — ${o.note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="journeys"
        title="Journeys that moved"
        lead="Where a journey's themes stepped during this period."
      >
        {journeysMoved.size === 0 ? (
          <Empty>No journey’s themes stepped this period.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...journeysMoved].map(([id, j]) => (
              <li key={id} className="rounded-card bg-surface px-4 py-3 text-sm hairline">
                <Link
                  href={`/journey/${id}#progression-h`}
                  className="font-serif text-base hover:underline"
                >
                  {j.title}
                </Link>
                <p className="mt-1 text-fg-muted">
                  {j.labels.join(' → ')} · from {j.sources.size}{' '}
                  {j.sources.size === 1 ? 'entry' : 'entries'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="open"
        title="Still open"
        lead="Readings from this period waiting on what happened."
      >
        {openLoops.length === 0 ? (
          <Empty>Nothing from this period is still open.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {openLoops.map((r) => (
              <li key={r.id} data-deck={r.deck.system}>
                <Link
                  href={`/reading/${r.id}#follow-up-h`}
                  className="block rounded-card border-l-2 border-accent bg-surface px-4 py-3 hairline hover:bg-surface-2"
                >
                  <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    <LocalTime iso={r.occurred_at} dateOnly />
                    <span className="tracking-normal normal-case"> · {r.deck.name}</span>
                  </p>
                  <p className="mt-1 font-serif text-base leading-snug">{titleOf(r)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="entries"
        title="Every entry"
        lead="The readings this period, under their own deck's names."
      >
        <ul className="flex flex-col gap-2" data-testid="retro-entries">
          {data.readings.map((r) => (
            <li key={r.id} data-deck={r.deck.system}>
              <Link
                href={`/reading/${r.id}`}
                className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
              >
                <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                  <LocalTime iso={r.occurred_at} dateOnly />
                  <span className="tracking-normal normal-case">
                    {' '}
                    · {r.spread.name} · {r.deck.name}
                  </span>
                </p>
                <p className="mt-1 font-serif text-base leading-snug">{titleOf(r)}</p>
                <p className="mt-1 text-xs text-fg-muted">
                  {r.cards.map((c) => c.card.name).join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
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

export async function generateMetadata({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  const p = parsePeriodKey(period);
  return { title: p ? periodLabel(p) : 'Look back' };
}
