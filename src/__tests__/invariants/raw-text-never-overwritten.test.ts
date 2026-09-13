import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariant 4 (spec §21): raw user text is never discarded or overwritten. AI metadata is
 * derived, versioned and reprocessable — it lives in its own tables and never touches
 * `readings.question`, `readings.user_notes` or `reading_cards.user_meaning`.
 * Structural half (the database proof is `raw-text-never-overwritten.integration.test.ts`):
 *   1. no derived-side code (AI layer, interpretation service, jobs, purge, export) writes to
 *      `readings` or `reading_cards` at all — the only writers are the user's own actions;
 *   2. every model-derived write goes through `modelWrite()` and carries no user-text column;
 *   3. the schema keeps every previous value: the `readings_keep_text` trigger writes
 *      `reading_note_revisions` before `user_notes` or `question` changes, whatever code path
 *      did the update, and the revisions table has no update policy (nothing can rewrite history).
 */
const ROOT = process.cwd();
const USER_TEXT_COLUMNS = ['user_notes', 'user_meaning'];

function files(dir: string): string[] {
  const abs = path.resolve(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(path.join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !e.name.includes('.test.')
        ? [path.join(dir, e.name)]
        : [],
  );
}
const read = (p: string) => readFileSync(path.resolve(ROOT, p), 'utf8');

describe('raw-text-never-overwritten', () => {
  it('1 · nothing on the derived side writes to readings or reading_cards', () => {
    const derived = [
      'src/ai',
      'src/interpretation',
      'src/jobs',
      'src/privacy',
      'src/export',
      // Phase 06: extraction reads the words and writes only derived tables.
      'src/memory',
      // Phase 07: journeys derive from derived rows and the question; they never write it.
      'src/journeys',
    ].flatMap(files);
    expect(derived.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const f of derived) {
      const src = read(f);
      if (
        /from\('readings'\)\s*\.(update|upsert|insert)\(/.test(src) ||
        /from\('reading_cards'\)\s*\.(update|upsert|insert)\(/.test(src) ||
        /\.update\(readings\)/.test(src) ||
        /\.update\(readingCards\)/.test(src) ||
        /update\s+(public\.)?readings\s+set/i.test(src) ||
        /update\s+(public\.)?reading_cards\s+set/i.test(src)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
    // The purge deletes a reading the user already deleted — a delete, never a rewrite.
    expect(read('src/privacy/purge.ts')).not.toMatch(/user_notes|user_meaning/);
    // Extraction reads question and notes into the prompt and never rewrites either; every
    // model-born memory row goes through modelBorn() (Phase 06).
    const materialize = read('src/memory/materialize.ts');
    expect(materialize).not.toMatch(/userNotes|user_notes|question/);
    expect((materialize.match(/modelBorn\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('2 · model-derived writes carry no user-text column and every one is gated', () => {
    const q = read('src/db/queries/interpretations.ts');
    const gated = q.match(/modelWrite\('TAROT_INTERPRETATION',\s*\{[\s\S]*?\n {2}\}\)/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(3);
    for (const block of gated) {
      for (const col of [...USER_TEXT_COLUMNS, 'question:']) expect(block).not.toContain(col);
    }
    // The interpretation store seam has no path to readings (asserted again at runtime by
    // reading-survives-ai-failure).
    expect(read('src/interpretation/store.ts')).not.toMatch(/from\('readings'\)/);
  });

  it('3 · the schema keeps every previous value by trigger, and revisions cannot be rewritten', () => {
    const sql = read('src/db/migrations/0006_journal.sql');
    expect(sql).toMatch(
      /CREATE TRIGGER readings_keep_text\s+BEFORE UPDATE OF user_notes, question, is_open_reflection ON public\.readings/,
    );
    expect(sql).toMatch(/INSERT INTO reading_note_revisions[\s\S]*'user_notes', OLD\.user_notes/);
    expect(sql).toMatch(/INSERT INTO reading_note_revisions[\s\S]*'question', OLD\.question/);
    // Policies: select + delete only — no update, no user insert.
    const policies = [...sql.matchAll(/CREATE POLICY "reading_note_revisions_(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(policies.sort()).toEqual(['delete', 'select']);
    // The user's own edits keep the text column as the user typed it (trim only).
    const readings = read('src/db/queries/readings.ts');
    expect(readings).toMatch(/updateReadingNotes[\s\S]*\.parse\(notes\)\.trim\(\) \|\| null/);
  });
});
