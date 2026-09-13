import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import {
  addAlias,
  addRole,
  closeRole,
  createEntity,
  getEntity,
  mergeEntities,
  splitEntity,
  undoMerge,
} from '@/db/queries/memory';
import { setAiConsent } from '@/db/queries/profile';
import { seedReferenceData } from '@/db/seed/reference';
import { runExtraction } from '@/memory/extract';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import { enableExtraction } from '@/__tests__/fixtures/memory-db';

/**
 * Invariant 5 against Postgres: merge moves aliases and mentions, keeps both partners' role
 * ranges as separate rows, re-scores nothing into a fact; undo restores the source exactly;
 * a split gives the chosen mentions their own entity; the immutability trigger refuses a
 * rewritten role.
 */
describe('alias-merge-preserves-historical-roles (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;
  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('merge');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('merge keeps conflicting role ranges apart, moves aliases and mentions, and undo restores everything', async () => {
    const old = await createEntity(user.client, user.id, {
      label: 'Alex',
      kind: 'person',
      alias: 'Al',
    });
    await addRole(user.client, user.id, old.id, 'partner', '2024-01-01');
    const oldDetail = (await getEntity(user.client, old.id))!;
    await closeRole(user.client, oldDetail.roles[0]!.id, '2024-12-31');
    const current = await createEntity(user.client, user.id, {
      label: 'Alex Rivera',
      kind: 'person',
      alias: 'Alex',
    });
    await addRole(user.client, user.id, current.id, 'partner', '2026-01-01');
    await addRole(user.client, user.id, current.id, 'friend', '2026-01-01');
    await addAlias(user.client, user.id, old.id, 'my ex');

    // Mentions on both sides, from real extractions.
    const r1 = await makeReading(user, refs, {
      question: null,
      notes: 'Al rang about the old flat.',
      occurredAt: '2024-03-01T12:00:00Z',
    });
    await runExtraction(r1.id);
    const r2 = await makeReading(user, refs, {
      question: 'How are things with Alex?',
      occurredAt: '2026-02-01T12:00:00Z',
    });
    await runExtraction(r2.id);
    const before = {
      source: (await getEntity(user.client, old.id))!,
      target: (await getEntity(user.client, current.id))!,
    };
    expect(before.source.mentions.map((m) => m.mention_text)).toContain('Al');
    expect(before.target.mentions.map((m) => m.mention_text)).toContain('Alex');

    const { mergeId, keptRoles } = await mergeEntities(user.client, old.id, current.id);
    expect(keptRoles).toBe(1);
    const merged = (await getEntity(user.client, current.id))!;
    // Both partner rows survive with their own ranges; nothing was rewritten.
    expect(merged.roles.map((r) => [r.role, r.valid_from, r.valid_to]).sort()).toEqual(
      [
        ['partner', '2024-01-01', '2024-12-31'],
        ['partner', '2026-01-01', null],
        ['friend', '2026-01-01', null],
      ].sort(),
    );
    expect(merged.aliases.map((a) => a.alias_normalized).sort()).toEqual([
      'al',
      'alex',
      'alex rivera',
      'ex',
    ]);
    expect(merged.mentions.map((m) => m.mention_text).sort()).toEqual(['Al', 'Alex']);
    expect(merged.user_confirmed).toBe(true);
    expect(merged.merges).toEqual([
      expect.objectContaining({ id: mergeId, source_entity_id: old.id, undone_at: null }),
    ]);
    const source = (await getEntity(user.client, old.id))!;
    expect(source.status).toBe('merged');
    expect(source.merged_into_id).toBe(current.id);
    expect(source.aliases).toEqual([]);
    expect(source.mentions).toEqual([]);
    // Moved mentions keep their (non-fact) resolutions.
    expect(
      merged.mentions.every(
        (m) => m.resolution === 'auto' || m.resolution === 'tentative' || m.resolution === 'user',
      ),
    ).toBe(true);

    await undoMerge(user.client, mergeId);
    const restoredSource = (await getEntity(user.client, old.id))!;
    const restoredTarget = (await getEntity(user.client, current.id))!;
    expect(restoredSource.status).toBe('active');
    expect(restoredSource.aliases.map((a) => a.alias_normalized).sort()).toEqual(
      before.source.aliases.map((a) => a.alias_normalized).sort(),
    );
    expect(restoredSource.roles.map((r) => [r.role, r.valid_from, r.valid_to])).toEqual(
      before.source.roles.map((r) => [r.role, r.valid_from, r.valid_to]),
    );
    expect(restoredSource.mentions.map((m) => m.id).sort()).toEqual(
      before.source.mentions.map((m) => m.id).sort(),
    );
    expect(restoredTarget.roles.map((r) => r.id).sort()).toEqual(
      before.target.roles.map((r) => r.id).sort(),
    );
    expect(restoredTarget.mentions.map((m) => m.id).sort()).toEqual(
      before.target.mentions.map((m) => m.id).sort(),
    );
    expect(restoredTarget.merges).toEqual([]);
    await expect(undoMerge(user.client, mergeId)).rejects.toThrow();
  });

  it('a role row cannot be rewritten; it can only be closed once', async () => {
    const e = await createEntity(user.client, user.id, { label: 'Priya', kind: 'person' });
    await addRole(user.client, user.id, e.id, 'manager', '2026-01-01');
    const role = (await getEntity(user.client, e.id))!.roles[0]!;
    const rewrite = await user.client
      .from('entity_roles')
      .update({ role: 'friend' })
      .eq('id', role.id);
    expect(rewrite.error?.code).toBe('23514');
    const shift = await user.client
      .from('entity_roles')
      .update({ valid_from: '2025-01-01' })
      .eq('id', role.id);
    expect(shift.error?.code).toBe('23514');
    await closeRole(user.client, role.id, '2026-03-01');
    const reopen = await user.client
      .from('entity_roles')
      .update({ valid_to: '2026-04-01' })
      .eq('id', role.id);
    expect(reopen.error?.code).toBe('23514');
    // A successor adds a row and closes the old one — the old range is still there.
    await addRole(user.client, user.id, e.id, 'colleague', '2026-05-01');
    const roles = (await getEntity(user.client, e.id))!.roles;
    expect(roles.map((r) => [r.role, r.valid_from, r.valid_to])).toEqual([
      ['colleague', '2026-05-01', null],
      ['manager', '2026-01-01', '2026-03-01'],
    ]);
  });

  it('split moves the chosen mentions to a new confirmed entity and pins both', async () => {
    const r1 = await makeReading(user, refs, {
      question: null,
      notes: 'Coffee with Sam after work.',
      occurredAt: '2026-03-01T12:00:00Z',
    });
    await runExtraction(r1.id);
    const r2 = await makeReading(user, refs, {
      question: null,
      notes: 'Talked to Sam, who wants to run the workshop at the club.',
      occurredAt: '2026-03-08T12:00:00Z',
    });
    await runExtraction(r2.id);
    const entity = (await getEntity(
      user.client,
      (await getEntity(
        user.client,
        (
          await user.client
            .from('entity_mentions')
            .select('entity_id')
            .eq('object_id', r1.id)
            .single()
        ).data!.entity_id,
      ))!.id,
    ))!;
    expect(entity.mentions).toHaveLength(2);
    const moving = entity.mentions.find((m) => m.object_id === r2.id)!;
    const { id: newId } = await splitEntity(
      user.client,
      entity.id,
      [moving.id],
      'Sam from the club',
      'person',
    );
    const created = (await getEntity(user.client, newId))!;
    const remaining = (await getEntity(user.client, entity.id))!;
    expect(created).toMatchObject({
      canonical_label: 'Sam from the club',
      user_confirmed: true,
      status: 'active',
    });
    expect(created.mentions.map((m) => [m.object_id, m.resolution])).toEqual([[r2.id, 'user']]);
    expect(created.aliases.map((a) => a.alias_normalized).sort()).toEqual([
      'sam',
      'sam from the club',
    ]);
    expect(remaining.mentions.map((m) => m.object_id)).toEqual([r1.id]);
    expect(remaining.aliases.map((a) => a.alias_normalized)).toContain('sam');
    expect(remaining.user_confirmed).toBe(true);
    // Splitting away every mention is refused.
    await expect(
      splitEntity(
        user.client,
        entity.id,
        remaining.mentions.map((m) => m.id),
        'x',
        'person',
      ),
    ).rejects.toThrow();
  });
});
