import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEntityContext, CONTEXT_RESOLUTIONS } from '../context';

/**
 * docs/ALGORITHMS.md §1: "tentative entities may never be stated as confirmed fact in
 * summaries". The prompt-context builder is the only way an entity list reaches a prompt,
 * and it admits `auto` and `user` resolutions only.
 */
describe('entity prompt context excludes tentative entities', () => {
  const entities = [
    { id: 'alex', canonicalLabel: 'Alex', kind: 'person', status: 'active' },
    { id: 'sam', canonicalLabel: 'Sam', kind: 'person', status: 'active' },
    { id: 'old', canonicalLabel: 'M.', kind: 'person', status: 'merged' },
    { id: 'leeds', canonicalLabel: 'Leeds', kind: 'place', status: 'active' },
  ];
  const mentions = [
    { entityId: 'alex', resolution: 'auto', mentionText: 'Alex' },
    { entityId: 'alex', resolution: 'user', mentionText: 'my girlfriend' },
    { entityId: 'sam', resolution: 'tentative', mentionText: 'Sami' },
    { entityId: 'leeds', resolution: 'rejected', mentionText: 'Leeds' },
    { entityId: 'old', resolution: 'auto', mentionText: 'M.' },
    { entityId: 'ghost', resolution: 'auto', mentionText: 'Nobody' },
  ];

  it('admits auto and user, drops tentative, rejected, merged and unknown', () => {
    expect([...CONTEXT_RESOLUTIONS]).toEqual(['auto', 'user']);
    const ctx = buildEntityContext(mentions, entities);
    expect(ctx).toEqual([
      { id: 'alex', label: 'Alex', kind: 'person', mentionedAs: ['Alex', 'my girlfriend'] },
    ]);
    expect(JSON.stringify(ctx)).not.toMatch(/Sam|Sami|Leeds|M\./);
  });

  it('the database builder filters by the same list before the rows leave Postgres', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/memory/context.server.ts'), 'utf8');
    expect(src).toMatch(/inArray\(entityMentions\.resolution, \[\.\.\.CONTEXT_RESOLUTIONS\]\)/);
    expect(src).not.toMatch(/tentative/);
  });
});
