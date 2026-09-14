import 'server-only';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { checkFeatureFor } from '@/billing/gate';
import { platformDb } from '@/db/admin';
import { journeys, periodSummaries, profiles } from '@/db/schema';
import { meetsSummaryFloor } from '@/domain/summaries/floors';
import { recentCompletePeriods, type Period } from '@/domain/summaries/periods';
import { flagForUser } from '@/flags/server';
import { enqueue } from '@/jobs/enqueue';
import { logger } from '@/observability/logger';
import { listPeriodObjectIds } from './evidence';

/**
 * Which summaries are due (FR-20): for each consenting, entitled user on the `period_summaries` flag,
 * every recent complete week and month that is above its data floor and has no stored
 * summary yet gets a `summarize_period` job; every open journey gets a `journey_narrative`
 * (the runner's fingerprint decides whether anything happens) and, above the journey floor,
 * a journey summary. Never regenerates an existing summary: that is the user's explicit
 * action. Bounded by `months` / `weeks`.
 */
export interface ScheduleResult {
  usersSeen: number;
  enqueued: number;
}

async function eligibleUsers(userId: string | null): Promise<string[]> {
  const rows = await platformDb()
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      userId
        ? and(eq(profiles.id, userId), isNotNull(profiles.aiConsentAt))
        : isNotNull(profiles.aiConsentAt),
    )
    .orderBy(profiles.id);
  const out: string[] = [];
  for (const r of rows) {
    if (!(await flagForUser('period_summaries', r.id))) continue;
    // Generation is premium (§14): the sweep never queues a job the budget would refuse.
    if (!(await checkFeatureFor(r.id, 'summaries')).allowed) continue;
    out.push(r.id);
  }
  return out;
}

/** Periods of a kind due for one user: complete, above floor, not yet summarised. */
export async function duePeriods(
  userId: string,
  kind: 'weekly' | 'monthly',
  count: number,
  today: string,
): Promise<(Period & { objectCount: number })[]> {
  if (count === 0) return [];
  const candidates = recentCompletePeriods(kind, today, count);
  const existing = await platformDb()
    .select({ start: periodSummaries.periodStart })
    .from(periodSummaries)
    .where(
      and(
        eq(periodSummaries.userId, userId),
        eq(periodSummaries.kind, kind),
        isNull(periodSummaries.journeyId),
        inArray(
          periodSummaries.periodStart,
          candidates.map((p) => p.start),
        ),
      ),
    );
  const have = new Set(existing.map((e) => e.start));
  const out: (Period & { objectCount: number })[] = [];
  for (const p of candidates) {
    if (have.has(p.start)) continue;
    const ids = await listPeriodObjectIds(userId, p);
    const objectCount = ids.readings.length + ids.events.length;
    if (meetsSummaryFloor(kind, objectCount)) out.push({ ...p, objectCount });
  }
  return out;
}

export async function scheduleSummaries(opts: {
  userId: string | null;
  months: number;
  weeks: number;
  now?: Date;
}): Promise<ScheduleResult> {
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const out: ScheduleResult = { usersSeen: 0, enqueued: 0 };
  for (const userId of await eligibleUsers(opts.userId)) {
    out.usersSeen += 1;
    const due = [
      ...(await duePeriods(userId, 'monthly', opts.months, today)),
      ...(await duePeriods(userId, 'weekly', opts.weeks, today)),
    ];
    for (const p of due) {
      await enqueue(
        'summarize_period',
        {
          userId,
          kind: p.kind,
          periodStart: p.start,
          periodEnd: p.end,
          journeyId: null,
          force: false,
        },
        { userId, dedupe: true },
      );
      out.enqueued += 1;
    }
    const open = await platformDb()
      .select({ id: journeys.id })
      .from(journeys)
      .where(
        and(
          eq(journeys.userId, userId),
          inArray(journeys.status, ['active', 'dormant']),
          isNull(journeys.mergedIntoId),
        ),
      );
    for (const j of open) {
      await enqueue(
        'journey_narrative',
        { journeyId: j.id, force: false },
        { userId, dedupe: true },
      );
      await enqueue(
        'summarize_period',
        {
          userId,
          kind: 'journey',
          periodStart: null,
          periodEnd: null,
          journeyId: j.id,
          force: false,
        },
        { userId, dedupe: true },
      );
      out.enqueued += 2;
    }
  }
  logger.info('summaries.scheduled', { count: out.enqueued, attempts: out.usersSeen });
  return out;
}
