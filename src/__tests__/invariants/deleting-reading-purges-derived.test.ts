import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import { READING_DEPENDENT_COUNTERS, readingRegistryTables } from '@/privacy/purge';

/**
 * Invariant 8 / spec §19: deleting a reading removes or invalidates every derived artifact.
 * Structural half (the database proof is `deleting-reading-purges-derived.integration.test.ts`):
 *   1. the purge job is driven by the registry — every table under the `reading` root has a
 *      counter, so a table added to the registry without a purge step fails here;
 *   2. every table with a `reading_id` foreign key is in the registry (the schema cannot grow a
 *      dependent the purge does not know about);
 *   3. the user-facing delete is a soft delete + `purge_deleted` job, and every read path
 *      filters `deleted_at`, so a deleted reading is out of every view before the purge runs.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.resolve(ROOT, p), 'utf8');

describe('deleting-reading-purges-derived', () => {
  it('1 · the purge job knows how to count and remove every registry target for a reading', () => {
    const tables = readingRegistryTables();
    expect(tables.length).toBeGreaterThanOrEqual(5);
    for (const t of tables)
      expect(READING_DEPENDENT_COUNTERS, `counter for ${t}`).toHaveProperty(t);
    // A `via: 'job'` target has an explicit remover (asserted by the purge throwing otherwise).
    const jobTargets = DELETION_REGISTRY.reading.filter((t) => t.via === 'job').map((t) => t.table);
    expect(jobTargets).toEqual(['safety_flags']);
    const purgeSrc = read('src/privacy/purge.ts');
    for (const t of jobTargets) expect(purgeSrc).toMatch(new RegExp(`delete from public\\.${t}`));
  });

  it('2 · every table that references readings.id is a registered dependent', () => {
    const migrations = ['0004_readings', '0005_ai_interpretation', '0006_journal']
      .map((m) => read(`src/db/migrations/${m}.sql`))
      .join('\n');
    const referencing = new Set<string>();
    for (const m of migrations.matchAll(
      /ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("reading_id"\) REFERENCES "public"\."readings"/g,
    )) {
      referencing.add(m[1]!);
    }
    expect([...referencing].sort()).toEqual(
      ['interpretations', 'question_embeddings', 'reading_cards', 'reading_note_revisions'].sort(),
    );
    const registered = new Set(readingRegistryTables());
    for (const t of referencing) expect(registered.has(t), `${t} registered`).toBe(true);
  });

  it('3 · delete is soft delete + purge job, and every read path filters deleted_at', () => {
    const actions = read('app/(app)/reading/actions.ts');
    expect(actions).toContain('softDeleteReading(');
    expect(actions).toContain("enqueue('purge_deleted'");
    expect(actions).not.toMatch(/from\('readings'\)\.delete\(/);

    const readings = read('src/db/queries/readings.ts');
    expect(readings).not.toMatch(/from\('readings'\)\s*\.delete\(/);
    // Each select from readings is paired with a deleted_at filter.
    const selects = readings.match(/from\('readings'\)\s*\.select\(/g)?.length ?? 0;
    const filtered = readings.match(/\.is\('deleted_at', null\)/g)?.length ?? 0;
    expect(selects).toBeGreaterThan(0);
    expect(filtered).toBeGreaterThanOrEqual(selects);
    expect(readings).toContain('readings!inner(deleted_at)'); // recent cards exclude deleted readings

    const journalSql = read('src/db/migrations/0006_journal.sql');
    expect(journalSql).toMatch(/search_readings[\s\S]*WHERE r\.deleted_at IS NULL/);
    expect(journalSql).toMatch(/replace_reading_cards[\s\S]*deleted_at IS NULL/);
    expect(read('src/export/build.ts')).toContain('isNull(readings.deletedAt)');
  });
});
