import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import * as purge from '@/privacy/purge';
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
    expect(jobTargets).toEqual([
      'safety_flags',
      'extractions',
      'metadata_overrides',
      'object_themes',
      'entity_mentions',
      'journey_members',
      'links',
      'retrieval_documents',
      'asks',
    ]);
    const purgeSrc = read('src/privacy/purge.ts');
    for (const t of jobTargets.filter((t) => t !== 'asks'))
      expect(purgeSrc).toMatch(new RegExp(`delete from public\\.${t}`));
    // Phase 09: an ask is not deleted with a reading — its references are scrubbed (§19).
    expect(purgeSrc).toMatch(
      /update public\.asks set[\s\S]*citations[\s\S]*claims[\s\S]*package_object_ids[\s\S]*dropped_object_ids/,
    );
    // The database cascades the document too, whichever path deletes the row.
    expect(read('src/db/migrations/0010_retrieval_ask.sql')).toMatch(
      /readings_retrieval_cascade AFTER DELETE ON public\.readings/,
    );
  });

  it('2 · every table that references readings.id is a registered dependent', () => {
    const migrations = [
      '0004_readings',
      '0005_ai_interpretation',
      '0006_journal',
      '0007_structured_memory',
      '0008_journeys',
      '0009_events_outcomes',
      '0010_retrieval_ask',
    ]
      .map((m) => read(`src/db/migrations/${m}.sql`))
      .join('\n');
    const referencing = new Set<string>();
    const detached = new Set<string>();
    for (const m of migrations.matchAll(
      /ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("reading_id"\) REFERENCES "public"\."readings"\("id"\) ON DELETE (\w+(?: \w+)?)/g,
    )) {
      // `set null` is a pointer that is cleared, not a dependent that must die (Phase 08:
      // life_events.reading_id, the user's "about this reading" origin).
      (m[2] === 'set null' ? detached : referencing).add(m[1]!);
    }
    expect([...referencing].sort()).toEqual(
      [
        'interpretations',
        'question_embeddings',
        'reading_cards',
        'reading_note_revisions',
        'predictions',
        'outcomes',
      ].sort(),
    );
    expect([...detached]).toEqual(['life_events']);
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
    // Phases 06 and 07 replaced the function (entity, journey filters); the live definition
    // must keep the filter.
    for (const m of ['0007_structured_memory', '0008_journeys'])
      expect(read(`src/db/migrations/${m}.sql`)).toMatch(
        /search_readings[\s\S]*WHERE r\.deleted_at IS NULL/,
      );
    expect(journalSql).toMatch(/replace_reading_cards[\s\S]*deleted_at IS NULL/);
    expect(read('src/export/build.ts')).toContain('isNull(readings.deletedAt)');
  });

  it('4 · life events (Phase 08) take the same path: registry-driven purge, soft delete, filtered reads', () => {
    const { EVENT_DEPENDENT_COUNTERS, eventRegistryTables } = purge;
    const tables = eventRegistryTables();
    expect(tables.length).toBeGreaterThanOrEqual(6);
    for (const t of tables) expect(EVENT_DEPENDENT_COUNTERS, `counter for ${t}`).toHaveProperty(t);
    const jobTargets = DELETION_REGISTRY.life_event
      .filter((t) => t.via === 'job')
      .map((t) => t.table);
    expect(jobTargets).toEqual([
      'event_media',
      'extractions',
      'metadata_overrides',
      'object_themes',
      'entity_mentions',
      'journey_members',
      'links',
      'retrieval_documents',
      'asks',
    ]);
    const purgeSrc = read('src/privacy/purge.ts');
    expect(purgeSrc).toMatch(/removeEventMedia\(/);
    expect(read('src/db/migrations/0010_retrieval_ask.sql')).toMatch(
      /life_events_retrieval_cascade AFTER DELETE ON public\.life_events/,
    ); // bytes go before rows
    expect(purgeSrc).toMatch(
      /where \(from_type = 'life_event' and from_id = \$\{id\}\) or \(to_type = 'life_event' and to_id = \$\{id\}\)/,
    );
    const actions = read('app/(app)/event/actions.ts');
    expect(actions).toContain('softDeleteEvent(');
    expect(actions).toMatch(/queue\('purge_deleted', \{ eventId/);
    const queries = read('src/db/queries/events.ts');
    expect(queries).not.toMatch(/from\('life_events'\)\s*\.delete\(/);
    const selects = queries.match(/from\('life_events'\)\s*\.select\(/g)?.length ?? 0;
    const filtered = queries.match(/\.is\('deleted_at', null\)/g)?.length ?? 0;
    expect(selects).toBeGreaterThan(0);
    expect(filtered).toBeGreaterThanOrEqual(selects);
    expect(read('src/export/build.ts')).toContain('isNull(lifeEvents.deletedAt)');
    // The reading purge also removes the links on either side.
    expect(READING_DEPENDENT_COUNTERS).toHaveProperty('links');
    expect(READING_DEPENDENT_COUNTERS).toHaveProperty('outcomes');
  });
});
