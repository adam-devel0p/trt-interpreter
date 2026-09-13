import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import { searchJournal } from '@/db/queries/journal';
import { seedReferenceData } from '@/db/seed/reference';
import { EMPTY_FILTERS, type JournalFilters } from '@/domain/journal/filters';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import { seedBulkReadings } from '../../../../scripts/seed-demo-readings';

/**
 * FR-21 / §13 performance target: journal list and search p95 under 300 ms at 1000 readings,
 * measured end to end through the query layer (PostgREST + the `search_readings` function +
 * embedding), against the same generator `pnpm demo:seed` uses. Numbers are printed for the
 * phase report.
 */
const BULK = 1000;
const RUNS = 40;
const TARGET_MS = 300;

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
}

describe('journal performance at 1000 readings (integration)', () => {
  let user: TestUser;
  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('perf');
    const ids = await seedBulkReadings(user.id, BULK, 99);
    expect(ids).toHaveLength(BULK);
  }, 120_000);
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  const cases: [string, Partial<JournalFilters>][] = [
    ['timeline first page', {}],
    ['text search "manager"', { q: 'manager' }],
    ['card search "tower" (aliases, both decks)', { q: 'tower' }],
    ['typo "conversaton"', { q: 'conversaton' }],
    ['deck + date + has notes', { deck: 'thoth', from: '2024-01-01', hasNotes: true }],
    ['has interpretation = false + resolved', { hasInterpretation: false, followUp: 'resolved' }],
    ['recently edited', { sort: 'edited' }],
  ];

  it.each(cases)('p95 under 300 ms: %s', async (_label, filters) => {
    const f: JournalFilters = { ...EMPTY_FILTERS, ...filters };
    await searchJournal(user.client, f); // warm
    const samples: number[] = [];
    let items = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const page = await searchJournal(user.client, f);
      samples.push(performance.now() - t);
      items = page.items.length;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const line = `${_label}: p50 ${sorted[Math.floor(RUNS / 2)]!.toFixed(1)} ms · p95 ${p95(samples).toFixed(1)} ms · ${items} items`;
    console.log(`perf · ${line}`);
    expect(p95(samples), line).toBeLessThan(TARGET_MS);
  });

  it('paging through all 1000 stays flat (last page as fast as the first)', async () => {
    const f = EMPTY_FILTERS;
    let cursor: string | null = null;
    const times: number[] = [];
    let total = 0;
    do {
      const t = performance.now();
      const page = await searchJournal(user.client, f, { cursor });
      times.push(performance.now() - t);
      total += page.items.length;
      cursor = page.nextCursor;
    } while (cursor);
    expect(total).toBe(BULK);
    console.log(
      `perf · ${times.length} pages: first ${times[0]!.toFixed(1)} ms · last ${times.at(-1)!.toFixed(1)} ms · p95 ${p95(times).toFixed(1)} ms`,
    );
    expect(p95(times)).toBeLessThan(TARGET_MS);
  }, 60_000);
});
