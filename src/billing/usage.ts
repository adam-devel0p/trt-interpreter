import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { usageCounters } from '@/db/schema';
import { featureForTask, type Feature, type UsageCounters } from '@/domain/billing/entitlements';

/**
 * Usage counters (§13 cost controls, §14 allowances). One row per user, UTC day and task;
 * a month is the sum of its days, so "reset per period" is arithmetic, not a job. Written by
 * `src/ai/telemetry.ts` after every run; read by the budget hook before every run and by
 * Profile (as the user, through RLS) to show the allowance honestly.
 */

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
export const utcMonthStart = (d: Date) => `${d.toISOString().slice(0, 7)}-01`;

export interface UsageRecord {
  userId: string;
  task: string;
  /** Only a run that reached the provider and came back `ok` consumes an allowance unit. */
  ok: boolean;
  tokens: number;
  costMicros: number;
  now?: Date;
}

export async function recordUsage(rec: UsageRecord): Promise<void> {
  const day = utcDay(rec.now ?? new Date());
  const calls = rec.ok ? 1 : 0;
  await platformDb()
    .insert(usageCounters)
    .values({
      userId: rec.userId,
      periodStart: day,
      task: rec.task,
      calls,
      tokens: rec.tokens,
      costMicros: rec.costMicros,
    })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.periodStart, usageCounters.task],
      set: {
        calls: sql`${usageCounters.calls} + ${calls}`,
        tokens: sql`${usageCounters.tokens} + ${rec.tokens}`,
        costMicros: sql`${usageCounters.costMicros} + ${rec.costMicros}`,
      },
    });
}

/** Successful runs this UTC month by feature, and any successful run today. */
export async function readUsage(userId: string, now = new Date()): Promise<UsageCounters> {
  const rows = await platformDb()
    .select({
      periodStart: usageCounters.periodStart,
      task: usageCounters.task,
      calls: usageCounters.calls,
    })
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), gte(usageCounters.periodStart, utcMonthStart(now))),
    );
  const today = utcDay(now);
  const month: Partial<Record<Feature, number>> = {};
  let todayCalls = 0;
  for (const r of rows) {
    let feature: Feature;
    try {
      feature = featureForTask(r.task);
    } catch {
      continue;
    }
    month[feature] = (month[feature] ?? 0) + r.calls;
    if (r.periodStart === today) todayCalls += r.calls;
  }
  return { month, today: todayCalls };
}
