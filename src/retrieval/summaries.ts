import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { periodSummaries } from '@/db/schema';
import type { EvidenceSummary } from '@/domain/retrieval/evidence';
import { periodContaining } from '@/domain/summaries/periods';
import type { StoredHighlights } from '@/domain/summaries/schema';
import { SUMMARY_SECTIONS } from '@/domain/summaries/schema';
import { ASK_COVERING_SUMMARIES_MAX } from '@/domain/summaries/thresholds';
import { flagForUser } from '@/flags/server';

/**
 * Covering summaries for an Ask package (spec §8.1 step 4 compression, Phase 09 notes): when
 * the bound left entries out, the stored monthly (else weekly) user-scope summaries whose
 * periods hold those entries travel with the package, at most `ASK_COVERING_SUMMARIES_MAX`,
 * each covering the most dropped entries first. Never dismissed or stale ones; never a
 * journey's. They augment — the verifier drops any claim that cites only them.
 */
export async function coveringSummaries(
  userId: string,
  droppedDates: readonly string[],
): Promise<EvidenceSummary[]> {
  if (droppedDates.length === 0) return [];
  if (!(await flagForUser('period_summaries', userId))) return [];
  const wanted = new Map<string, number>();
  for (const d of droppedDates) {
    for (const kind of ['monthly', 'weekly'] as const) {
      const p = periodContaining(kind, d);
      const key = `${kind}|${p.start}`;
      wanted.set(key, (wanted.get(key) ?? 0) + 1);
    }
  }
  const starts = [...new Set([...wanted.keys()].map((k) => k.split('|')[1]!))];
  const rows = await platformDb()
    .select()
    .from(periodSummaries)
    .where(
      and(
        eq(periodSummaries.userId, userId),
        eq(periodSummaries.scope, 'user'),
        isNull(periodSummaries.dismissedAt),
        isNull(periodSummaries.staleAt),
        inArray(periodSummaries.kind, ['monthly', 'weekly']),
        inArray(periodSummaries.periodStart, starts),
      ),
    );
  const scored = rows
    .map((r) => ({ r, covers: wanted.get(`${r.kind}|${r.periodStart}`) ?? 0 }))
    .filter((x) => x.covers > 0)
    // Months cover more; prefer them, then by how many dropped entries each covers.
    .sort((a, b) => b.covers - a.covers || (a.r.kind === 'monthly' ? -1 : 1));
  const out: EvidenceSummary[] = [];
  const coveredMonths = new Set<string>();
  for (const { r } of scored) {
    if (out.length >= ASK_COVERING_SUMMARIES_MAX) break;
    // A week inside an already-added month adds nothing.
    if (r.kind === 'weekly' && coveredMonths.has(periodContaining('monthly', r.periodStart).start))
      continue;
    if (r.kind === 'monthly') coveredMonths.add(r.periodStart);
    const highlights = r.highlights as StoredHighlights;
    out.push({
      id: r.id,
      kind: r.kind as EvidenceSummary['kind'],
      periodKey: periodContaining(r.kind as 'monthly' | 'weekly', r.periodStart).key,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      headline: r.summary,
      claims: SUMMARY_SECTIONS.flatMap((s) => highlights[s]?.map((c) => c.text) ?? []),
      coversCount: r.objectCount,
    });
  }
  return out;
}
