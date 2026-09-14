import Link from 'next/link';
import { getSessionClient, requireUser } from '@/auth/session';
import { listActivePeriodStarts } from '@/db/queries/retrospective';
import { listSummaries } from '@/db/queries/summaries';
import { summaryFloor } from '@/domain/summaries/floors';
import {
  inPeriod,
  periodContaining,
  periodLabel,
  recentCompletePeriods,
} from '@/domain/summaries/periods';
import { EmptyState } from '@/ui/components/empty-state';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'Look back' };
export const dynamic = 'force-dynamic';

/**
 * The retrospective index (spec §15.2): the recent complete months, each with what it holds,
 * and the weeks that had enough in them. A period below the data floor is listed with its
 * count and no link — nothing is generated for it and there is nothing to open (§4.3 no
 * filler). No model call.
 */
export default async function RetrospectiveIndex() {
  await requireUser();
  const client = await getSessionClient();
  const today = new Date().toISOString().slice(0, 10);
  const [active, summaries] = await Promise.all([
    listActivePeriodStarts(client),
    listSummaries(client, { includeDismissed: true, limit: 60 }),
  ]);
  const summarised = new Map(summaries.map((s) => [`${s.kind}|${s.period_start}`, s]));
  const count = (p: { start: string; end: string }) => ({
    readings: active.readings.filter((d) => inPeriod(p, d)).length,
    events: active.events.filter((d) => inPeriod(p, d)).length,
  });
  const months = recentCompletePeriods('monthly', today, 12)
    .map((p) => ({ p, ...count(p) }))
    .filter((m) => m.readings + m.events > 0);
  const weeks = recentCompletePeriods('weekly', today, 8)
    .map((p) => ({ p, ...count(p) }))
    .filter((w) => w.readings + w.events >= summaryFloor('weekly'));
  const current = periodContaining('monthly', today);
  const now = count(current);

  return (
    <>
      <PageHeader
        title="Look back"
        description="A month at a time, from what you recorded — readings, what happened, what you confirmed. Nothing is written for a month too thin to say anything about."
      />
      <section aria-labelledby="months-h" className="mb-8">
        <h2 id="months-h" className="mb-3 font-serif text-xl">
          Months
        </h2>
        {months.length === 0 ? (
          <EmptyState
            title="No complete month yet"
            description={`So far this month: ${now.readings} ${now.readings === 1 ? 'reading' : 'readings'}${now.events ? ` and ${now.events} ${now.events === 1 ? 'life event' : 'life events'}` : ''}. The look-back opens once the month is over.`}
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="retro-months">
            {months.map(({ p, readings, events }) => {
              const enough = readings + events >= summaryFloor('monthly');
              const s = summarised.get(`monthly|${p.start}`);
              const body = (
                <>
                  <p className="font-serif text-lg leading-snug">{periodLabel(p)}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {readings} {readings === 1 ? 'reading' : 'readings'}
                    {events ? `, ${events} ${events === 1 ? 'life event' : 'life events'}` : ''}
                    {enough
                      ? s
                        ? s.dismissed_at
                          ? ' · summary dismissed'
                          : ' · summary written'
                        : ''
                      : ` · too few entries to look back on (needs ${summaryFloor('monthly')})`}
                  </p>
                </>
              );
              return (
                <li key={p.key}>
                  {enough ? (
                    <Link
                      href={`/retrospective/${p.key}`}
                      className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="rounded-card border border-dashed border-hairline-strong px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {weeks.length ? (
        <section aria-labelledby="weeks-h">
          <h2 id="weeks-h" className="mb-3 font-serif text-xl">
            Weeks with enough in them
          </h2>
          <ul className="flex flex-col gap-2">
            {weeks.map(({ p, readings, events }) => (
              <li key={p.key}>
                <Link
                  href={`/retrospective/${p.key}`}
                  className="block rounded-card bg-surface px-4 py-3 hairline hover:bg-surface-2"
                >
                  <p className="font-serif text-base leading-snug">{periodLabel(p)}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {readings} {readings === 1 ? 'reading' : 'readings'}
                    {events ? `, ${events} ${events === 1 ? 'life event' : 'life events'}` : ''}
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
