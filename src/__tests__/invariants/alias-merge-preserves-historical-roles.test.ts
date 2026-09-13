import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planMerge } from '@/domain/entities/merge';
import { planRoleChange } from '@/domain/entities/roles';

/**
 * Invariant 5 (spec §7.1): aliases are not identities, and roles are temporal. Merging two
 * entities moves aliases and mentions but never collapses role history — a role row with a
 * different date range survives as its own row, and no row's `role` / `valid_from` is ever
 * rewritten. Three layers:
 *   1. the merge plan (pure) keeps every role row that is not an exact duplicate;
 *   2. a role change is add-and-close, never an update of `role`;
 *   3. the database forbids rewriting a role (`entity_roles_immutable` trigger) and the merge
 *      function only ever re-points `entity_id`.
 * The database proof is `alias-merge-preserves-historical-roles.integration.test.ts`.
 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('alias-merge-preserves-historical-roles', () => {
  it('1 · merging keeps role rows with differing ranges apart and drops only exact duplicates', () => {
    const source = {
      id: 'A',
      aliases: [{ id: 'a1', aliasNormalized: 'alex' }],
      mentions: [],
      roles: [
        { id: 'r-old', role: 'partner', validFrom: '2024-01-01', validTo: '2024-12-31' },
        { id: 'r-dup', role: 'friend', validFrom: '2025-01-01', validTo: null },
      ],
    };
    const target = {
      id: 'B',
      aliases: [],
      mentions: [],
      roles: [
        { id: 'r-new', role: 'partner', validFrom: '2026-01-01', validTo: null },
        { id: 'r-same', role: 'friend', validFrom: '2025-01-01', validTo: null },
      ],
    };
    const plan = planMerge(source, target);
    expect(plan.moveRoles).toEqual(['r-old']); // same role, different range: preserved
    expect(plan.dropRoles).toEqual(['r-dup']); // identical row: a duplicate
    expect(plan.moveAliases).toEqual(['a1']);
  });

  it('2 · a role change closes the previous range and adds a row; nothing is rewritten', () => {
    const rows = [{ id: 'r1', role: 'partner', validFrom: '2026-01-01', validTo: null }];
    const plan = planRoleChange(rows, 'ex_partner', '2026-06-01T00:00:00Z');
    expect(plan.close).toEqual([{ id: 'r1', validTo: '2026-05-31' }]);
    expect(plan.add).toEqual({ role: 'ex_partner', validFrom: '2026-06-01' });
    // The input rows are untouched (pure).
    expect(rows[0]).toEqual({ id: 'r1', role: 'partner', validFrom: '2026-01-01', validTo: null });
  });

  it('3 · the database forbids rewriting a role and the merge only re-points entity_id', () => {
    const sql = read('src/db/migrations/0007_structured_memory.sql');
    expect(sql).toMatch(
      /CREATE TRIGGER entity_roles_immutable BEFORE UPDATE ON public\.entity_roles/,
    );
    expect(sql).toMatch(/NEW\.role IS DISTINCT FROM OLD\.role/);
    expect(sql).toMatch(/NEW\.valid_from IS DISTINCT FROM OLD\.valid_from/);
    const merge = sql.slice(
      sql.indexOf('FUNCTION public.apply_entity_merge'),
      sql.indexOf('FUNCTION public.undo_entity_merge'),
    );
    const roleUpdates = [...merge.matchAll(/UPDATE entity_roles SET ([^;]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(roleUpdates.length).toBeGreaterThan(0);
    for (const u of roleUpdates) expect(u).toMatch(/^entity_id = p_target WHERE/);
    // The user-side query layer never updates a role's role or valid_from either.
    const queries = read('src/db/queries/memory.ts');
    expect(queries).not.toMatch(/from\('entity_roles'\)\s*\.update\(\{\s*role/);
    expect(queries).toMatch(/from\('entity_roles'\)\.update\(\{ valid_to: to \}\)/);
  });
});
