import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ANALYTICS_EVENTS, validateAnalyticsEvent } from '@/domain/analytics/events';
import {
  monthlyRetrospectiveCopy,
  revisitCopy,
  weeklyReflectionCopy,
} from '@/domain/notifications/copy';
import { createLogger, sanitizeProps, type LogLine } from '@/observability/logger';
import { CONTENT_FIELDS, scrubEvent } from '@/observability/scrub';

/**
 * Invariant 12 (spec §21, §19 "no raw journal content in standard logs/analytics events").
 * Live since Phase 11. Four channels leave the process; each is content-free by
 * construction and proven here:
 *
 *   1. the logger — a closed prop whitelist (type-level in `logger.test-d.ts`, runtime here);
 *   2. Sentry — `beforeSend` scrubs request bodies and every known content field;
 *   3. analytics — a per-event Zod allowlist with no string field at all;
 *   4. reminders — copy built from dates and counts, never an entry's words;
 *
 * plus a structural sweep: no `analytics_events` insert outside the tracker, no direct
 * console logging of a content variable in `src/` or `app/`.
 */

const CONTENT = {
  question: 'Should I take the job Maya offered?',
  user_notes: 'I am terrified of letting Dad down.',
  description: 'Moved out of the flat with Sam.',
  canonical_label: 'Maya',
};

describe('no-journal-content-in-logs', () => {
  it('1. the logger drops content-bearing props at runtime, whatever the caller passes', () => {
    const lines: LogLine[] = [];
    const log = createLogger((l) => lines.push(l));
    log.info('app.reading.saved', {
      userId: 'u',
      objectId: 'r',
      ...(CONTENT as unknown as Record<string, never>),
    });
    const line = JSON.stringify(lines[0]);
    for (const v of Object.values(CONTENT)) expect(line).not.toContain(v);
    expect(sanitizeProps(CONTENT)).toEqual({});
    // A long identifier field cannot smuggle prose either.
    expect((sanitizeProps({ objectId: 'x'.repeat(500) }).objectId as string).length).toBe(128);
    // Nor can the event name be free text.
    expect(() => log.info('this is my question' as never)).toThrow();
  });

  it('2. the Sentry scrubber redacts every content field and drops request bodies', () => {
    const event = scrubEvent({
      request: { data: CONTENT, headers: { cookie: 'x', authorization: 'y', 'x-a': 'b' } },
      extra: { reading: { ...CONTENT, id: 'r' } },
      breadcrumbs: [{ message: CONTENT.question, data: { note: CONTENT.user_notes } }],
      exception: { values: [{ value: `failed: {"question":"${CONTENT.question}"}` }] },
    });
    const json = JSON.stringify(event);
    for (const v of Object.values(CONTENT)) expect(json).not.toContain(v);
    for (const f of ['question', 'user_notes', 'description', 'canonical_label', 'note', 'body'])
      expect(CONTENT_FIELDS.has(f), f).toBe(true);
  });

  it('3. analytics: no event can carry a question or a note — rejected by schema at runtime', () => {
    for (const name of Object.keys(ANALYTICS_EVENTS)) {
      const attempt = validateAnalyticsEvent(name, { question: CONTENT.question });
      expect(attempt.ok, name).toBe(false);
      const attempt2 = validateAnalyticsEvent(name, { user_notes: CONTENT.user_notes });
      expect(attempt2.ok, name).toBe(false);
    }
    // And no schema even has a place for text: every leaf is an enum, boolean or number.
    const walk = (s: z.ZodType, acc: string[] = []): string[] => {
      const def = (s as unknown as { def: { type: string } }).def;
      if (def.type === 'object')
        for (const v of Object.values((s as z.ZodObject).shape)) walk(v as z.ZodType, acc);
      else if (def.type === 'nullable' || def.type === 'optional')
        walk((s as unknown as { unwrap(): z.ZodType }).unwrap(), acc);
      else acc.push(def.type);
      return acc;
    };
    for (const [name, schema] of Object.entries(ANALYTICS_EVENTS))
      for (const leaf of walk(schema))
        expect(['enum', 'boolean', 'number'], `${name}: ${leaf}`).toContain(leaf);
  });

  it('4. reminder copy is built from dates and counts; the schema of a stored reminder has no content column', () => {
    const copies = [
      revisitCopy({ occurredAt: '2026-03-30T00:00:00Z', deckName: 'Thoth' }),
      monthlyRetrospectiveCopy({ monthLabel: 'August 2026', readings: 3, events: 2 }),
      weeklyReflectionCopy({ weekLabel: 'Week of 31 August 2026', entries: 4 }),
    ];
    for (const c of copies) {
      expect(c.title.length + c.body.length).toBeLessThan(400);
      expect(`${c.title} ${c.body}`).not.toMatch(/\?/); // never quotes a question
    }
    const dispatch = readFileSync(
      path.resolve(process.cwd(), 'src/notifications/dispatch.ts'),
      'utf8',
    );
    // The dispatcher reads only ids, dates and deck names off a reading — never its text.
    expect(dispatch).not.toMatch(/readings\.(question|userNotes)/);
    expect(dispatch).not.toMatch(/\.question\b/);
  });

  it('structural: analytics rows are written only by the tracker; no console logging of content in src/ or app/', () => {
    const files = walkTs(['src', 'app']).filter(
      (f) => !f.includes('__tests__') && !/\.test\./.test(f),
    );
    const inserters = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /insert\(analyticsEvents\)|from\('analytics_events'\)\s*\.insert/.test(src);
    });
    expect(inserters.map((f) => path.relative(process.cwd(), f))).toEqual([
      'src/analytics/track.ts',
    ]);
    const consoleContent = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /console\.(log|info|warn|error)\([^)]*\b(question|user_notes|userNotes|notes|description|canonical_label)\b/.test(
        src,
      );
    });
    expect(consoleContent).toEqual([]);
    // The AI telemetry record type has no text-shaped field.
    const telemetry = readFileSync(path.resolve(process.cwd(), 'src/ai/telemetry.ts'), 'utf8');
    const record = telemetry.slice(
      telemetry.indexOf('interface AiCallRecord'),
      telemetry.indexOf('interface AiTelemetrySink'),
    );
    expect(record).not.toMatch(/\b(prompt|completion|content|text|messages|question|notes)\b/);
  });
});

function walkTs(dirs: string[]): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) visit(path.resolve(process.cwd(), d));
  return out;
}
