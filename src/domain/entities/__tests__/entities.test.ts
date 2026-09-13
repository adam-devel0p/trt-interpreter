import { describe, expect, it } from 'vitest';
import { WriteGateError, modelBorn } from '@/domain/facts/writeGate';
import { planApply } from '../apply';
import { planMerge, planSplit } from '../merge';
import { isPronoun, looksLikeName, normalizeAlias } from '../normalize';
import {
  isDescriptor,
  roleForDescriptor,
  roleForRelation,
  rolesCompatible,
  rolesExclusive,
} from '../relations';
import { activeRolesOn, planRoleChange } from '../roles';
import { trigramSimilarity } from '../trigram';

describe('normalizeAlias', () => {
  it('drops case, possessive framing, punctuation and diacritics', () => {
    expect(normalizeAlias('My Girlfriend')).toBe('girlfriend');
    expect(normalizeAlias("my girlfriend's")).toBe('girlfriend');
    expect(normalizeAlias('the Agency,')).toBe('agency');
    expect(normalizeAlias('Zoë')).toBe('zoe');
    expect(normalizeAlias('M.')).toBe('m');
    expect(normalizeAlias('  our   old  flat ')).toBe('old flat');
  });
  it('recognises pronouns and names', () => {
    expect(isPronoun('She')).toBe(true);
    expect(isPronoun('Alex')).toBe(false);
    expect(looksLikeName('Alex', isDescriptor)).toBe(true);
    expect(looksLikeName('my girlfriend', isDescriptor)).toBe(false);
    expect(looksLikeName('the agency', isDescriptor)).toBe(false);
    expect(looksLikeName('Priya Nair', isDescriptor)).toBe(true);
    expect(looksLikeName('my Mum', isDescriptor)).toBe(false);
  });
});

describe('relations', () => {
  it('maps descriptors and free-text relations onto stable roles', () => {
    expect(roleForDescriptor('girlfriend')?.role).toBe('partner');
    expect(roleForDescriptor('old agency')?.role).toBe('former_employer');
    expect(roleForDescriptor('alex')).toBeNull();
    expect(roleForRelation('my manager')?.role).toBe('manager');
    expect(roleForRelation('ex-partner')?.role).toBe('ex_partner');
    expect(roleForRelation('former employer')?.role).toBe('former_employer');
    expect(roleForRelation('Employer')?.role).toBe('employer');
    expect(roleForRelation('best mate')).toBeNull();
    expect(roleForRelation(null)).toBeNull();
  });
  it('compatibility follows succession; exclusivity follows families', () => {
    expect(rolesCompatible('partner', 'ex_partner')).toBe(true);
    expect(rolesCompatible('employer', 'former_employer')).toBe(true);
    expect(rolesCompatible('friend', 'colleague')).toBe(false);
    expect(rolesExclusive('friend', 'colleague')).toBe(false);
    expect(rolesExclusive('partner', 'sibling')).toBe(true);
    expect(rolesExclusive('parent', 'sibling')).toBe(true);
    expect(rolesExclusive('partner', 'ex_partner')).toBe(false);
    expect(rolesExclusive('manager', 'friend')).toBe(false);
  });
});

describe('temporal roles are never overwritten', () => {
  const partner = { id: 'r1', role: 'partner', validFrom: '2026-01-01', validTo: null };
  it('the same active role is a no-op', () => {
    expect(planRoleChange([partner], 'partner', '2026-03-01T00:00:00Z')).toEqual({
      close: [],
      add: null,
    });
  });
  it('a successor closes the previous range the day before and adds a new row', () => {
    const plan = planRoleChange([partner], 'ex_partner', '2026-05-10T09:00:00Z');
    expect(plan).toEqual({
      close: [{ id: 'r1', validTo: '2026-05-09' }],
      add: { role: 'ex_partner', validFrom: '2026-05-10' },
    });
  });
  it('a successor on the same day the role began never closes before it began', () => {
    const plan = planRoleChange([partner], 'ex_partner', '2026-01-01T09:00:00Z');
    expect(plan.close).toEqual([{ id: 'r1', validTo: '2026-01-01' }]);
  });
  it('an unrelated role coexists', () => {
    const plan = planRoleChange([partner], 'colleague', '2026-05-10T09:00:00Z');
    expect(plan).toEqual({ close: [], add: { role: 'colleague', validFrom: '2026-05-10' } });
  });
  it('a closed role stays in history and is inactive after valid_to', () => {
    const rows = [
      { ...partner, validTo: '2026-05-09' },
      { id: 'r2', role: 'ex_partner', validFrom: '2026-05-10', validTo: null },
    ];
    expect(activeRolesOn(rows, '2026-03-01').map((r) => r.role)).toEqual(['partner']);
    expect(activeRolesOn(rows, '2026-06-01').map((r) => r.role)).toEqual(['ex_partner']);
  });
});

describe('merge / split plans', () => {
  const source = {
    id: 'A',
    aliases: [
      { id: 'a1', aliasNormalized: 'alex' },
      { id: 'a2', aliasNormalized: 'al' },
    ],
    mentions: [
      { id: 'm1', mentionNormalized: 'alex', objectType: 'reading', objectId: 'r1' },
      { id: 'm2', mentionNormalized: 'al', objectType: 'reading', objectId: 'r2' },
      { id: 'm3', mentionNormalized: 'alex', objectType: 'reading', objectId: 'r3' },
    ],
    roles: [
      { id: 'ro1', role: 'friend', validFrom: '2025-01-01', validTo: null },
      { id: 'ro2', role: 'colleague', validFrom: '2024-01-01', validTo: '2024-12-31' },
    ],
  };
  const target = {
    id: 'B',
    aliases: [{ id: 'b1', aliasNormalized: 'alex' }],
    mentions: [{ id: 'm9', mentionNormalized: 'alex', objectType: 'reading', objectId: 'r3' }],
    roles: [
      { id: 'ro9', role: 'friend', validFrom: '2025-01-01', validTo: null },
      { id: 'ro8', role: 'colleague', validFrom: '2025-06-01', validTo: null },
    ],
  };
  it('moves what the target lacks, drops exact duplicates, keeps conflicting role ranges apart', () => {
    const plan = planMerge(source, target);
    expect(plan.moveAliases).toEqual(['a2']);
    expect(plan.dropAliases).toEqual(['a1']);
    expect(plan.moveMentions).toEqual(['m1', 'm2']);
    expect(plan.dropMentions).toEqual(['m3']);
    // friend 2025-01-01→ is identical on both sides: dropped. colleague 2024 ≠ colleague 2025: kept.
    expect(plan.moveRoles).toEqual(['ro2']);
    expect(plan.dropRoles).toEqual(['ro1']);
  });
  it('refuses a self-merge', () => {
    expect(() => planMerge(source, source)).toThrow();
  });
  it('split moves the chosen mentions and the aliases only they used, copying shared ones', () => {
    const plan = planSplit(source, ['m2']);
    expect(plan.moveMentions).toEqual(['m2']);
    expect(plan.moveAliases).toEqual(['a2']);
    expect(plan.copyAliases).toEqual([]);
    const shared = planSplit(source, ['m1']);
    expect(shared.copyAliases).toEqual(['a1']);
    expect(shared.moveAliases).toEqual([]);
    expect(() => planSplit(source, [])).toThrow();
    expect(() => planSplit(source, ['m1', 'm2', 'm3'])).toThrow();
  });
});

describe('planApply', () => {
  const m = {
    text: 'Alex',
    kind: 'person' as const,
    relation: 'partner',
    occurredAt: '2026-02-01T10:00:00Z',
  };
  it('a tentative decision touches nothing on the entity', () => {
    const mut = planApply(
      {
        kind: 'tentative',
        entityId: 'e1',
        score: 0.7,
        signals: null as never,
        reasons: [],
        namesEntity: false,
        role: null,
      },
      m,
      { aliases: [], roles: [] },
    );
    expect(mut.addAlias).toBeNull();
    expect(mut.rename).toBeNull();
    expect(mut.roles).toBeNull();
    expect(mut.touchLastSeen).toBeNull();
    expect(mut.mention?.resolution).toBe('tentative');
  });
  it('a new entity carries the alias and the framed role from day one', () => {
    const mut = planApply(
      {
        kind: 'new',
        canonicalLabel: 'my girlfriend',
        entityKind: 'person',
        role: roleForDescriptor('girlfriend'),
        bestScore: null,
      },
      { ...m, text: 'my girlfriend' },
      null,
    );
    expect(mut.createEntity).toEqual({
      canonicalLabel: 'my girlfriend',
      kind: 'person',
      alias: { alias: 'my girlfriend', normalized: 'girlfriend', context: 'partner' },
      role: { role: 'partner', validFrom: '2026-02-01' },
    });
  });
});

describe('trigram mirror', () => {
  it('matches pg_trgm on the cases the thresholds rely on', () => {
    expect(trigramSimilarity('sami', 'sam')).toBeCloseTo(0.5, 5);
    expect(trigramSimilarity('alex', 'alexa')).toBeCloseTo(4 / 7, 5);
    // 'old' → 4 trigrams, 'agency' → 7; the shared word is 7 of 11.
    expect(trigramSimilarity('old agency', 'agency')).toBeCloseTo(7 / 11, 5);
    expect(trigramSimilarity('samantha', 'sam')).toBeLessThan(0.45);
    expect(trigramSimilarity('', 'sam')).toBe(0);
  });
});

describe('write gate for model-born memory rows', () => {
  it('refuses user_confirmed, source=user, resolution=user, and user-only fact statuses', () => {
    expect(() => modelBorn({ user_confirmed: true })).toThrow(WriteGateError);
    expect(() => modelBorn({ userConfirmed: true })).toThrow(WriteGateError);
    expect(() => modelBorn({ source: 'user' })).toThrow(WriteGateError);
    expect(() => modelBorn({ resolution: 'user' })).toThrow(WriteGateError);
    expect(() => modelBorn({ resolution: 'rejected' })).toThrow(WriteGateError);
    expect(() => modelBorn({ fact_status: 'CONFIRMED_FACT' })).toThrow(WriteGateError);
    expect(modelBorn({ user_confirmed: false, source: 'model', resolution: 'tentative' })).toEqual({
      user_confirmed: false,
      source: 'model',
      resolution: 'tentative',
    });
    expect(modelBorn({ fact_status: 'POSSIBILITY' }).fact_status).toBe('POSSIBILITY');
  });
});
