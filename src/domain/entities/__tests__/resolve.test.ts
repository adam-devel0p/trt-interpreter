import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EntityKind } from '@/domain/extraction/schema';
import {
  changesHistory,
  resolveMention,
  scoreCandidate,
  type CandidateEntity,
  type MentionInput,
} from '../resolve';
import {
  ALIAS_EXACT,
  ALIAS_NAMES_DESCRIPTOR,
  ALIAS_ROLE_SUCCESSOR,
  ALIAS_TRIGRAM,
  AMBIGUOUS_MARGIN,
  AUTO_LINK,
  AUTO_MARGIN,
  TENTATIVE,
  TRIGRAM_MIN,
  WEIGHTS,
} from '../thresholds';
import { SimStore } from './simulate';

/**
 * Entity resolution against the hand-authored histories in `fixtures/history/` (spec §7.1,
 * docs/ALGORITHMS.md §1) and against every documented threshold boundary.
 */

interface FixtureStep {
  day: number;
  mentions: { text: string; kind: EntityKind; relation: string | null }[];
  expect: {
    text: string;
    decision: 'new' | 'auto' | 'tentative' | 'ask' | 'drop';
    entity?: string;
    renamedTo?: string;
    roles?: string[];
    entityRoles?: string[];
    candidatesRoles?: string[][];
  }[];
  userLinks?: { text: string; entity: string }[];
  userCreates?: { label: string; kind: EntityKind; roles: string[] }[];
  expectRoles?: Record<string, { role: string; validFrom: string; validTo: string | null }[]>;
}
interface HistoryFixture {
  name: string;
  description: string;
  steps: FixtureStep[];
}

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/history');
const T0 = Date.UTC(2026, 0, 1, 12);
const at = (day: number) => new Date(T0 + day * 86_400_000).toISOString();
const dayOf = (spec: string | null) =>
  spec === null ? null : at(Number(spec.replace('day ', ''))).slice(0, 10);

describe('entity resolution · fixtures/history', () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThanOrEqual(3);

  for (const file of files) {
    const fx = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8')) as HistoryFixture;
    it(`${fx.name}: ${fx.description.split('.')[0]}`, () => {
      const store = new SimStore();
      for (const step of fx.steps) {
        const when = at(step.day);
        for (const c of step.userCreates ?? []) store.userCreate(c.label, c.kind, c.roles, when);
        for (const link of step.userLinks ?? []) {
          const target = store.byLabel(link.entity)!;
          const m: MentionInput = {
            text: link.text,
            kind: target.kind,
            relation: null,
            occurredAt: when,
          };
          // The user answered: the relation the descriptor carries becomes the role.
          store.userLink(
            { ...m, relation: link.text.includes('ex') ? 'ex-partner' : null },
            target.id,
          );
        }
        for (const [i, mention] of step.mentions.entries()) {
          const exp = step.expect[i]!;
          expect(exp.text, `${fx.name} day ${step.day}`).toBe(mention.text);
          const before = new Map(store.entities.map((e) => [e.id, e.canonicalLabel]));
          const decision = store.mention({ ...mention, occurredAt: when });
          const label = `${fx.name} day ${step.day} "${mention.text}"`;
          expect(decision.kind, `${label} → ${JSON.stringify(decision)}`).toBe(exp.decision);
          if (decision.kind === 'new') {
            const created = store.entities.at(-1)!;
            expect(created.canonicalLabel, label).toBe(exp.entity);
            expect(
              created.roles.map((r) => r.role),
              label,
            ).toEqual(exp.roles ?? []);
          }
          if (decision.kind === 'auto' || decision.kind === 'tentative') {
            expect(before.get(decision.entityId), label).toBe(exp.entity);
            if (exp.renamedTo)
              expect(store.byId(decision.entityId).canonicalLabel).toBe(exp.renamedTo);
            if (exp.entityRoles)
              expect(
                store
                  .byId(decision.entityId)
                  .roles.filter((r) => !r.validTo)
                  .map((r) => r.role),
              ).toEqual(exp.entityRoles);
            if (decision.kind === 'tentative') {
              // A tentative link changes nothing on the entity.
              expect(store.byId(decision.entityId).canonicalLabel).toBe(
                before.get(decision.entityId),
              );
            }
          }
          if (decision.kind === 'ask') {
            const roles = decision.candidates.map((c) => c.entity.roles.map((r) => r.role));
            expect(roles.map((r) => r.join(',')).sort()).toEqual(
              (exp.candidatesRoles ?? []).map((r) => r.join(',')).sort(),
            );
          }
        }
        for (const [label, roles] of Object.entries(step.expectRoles ?? {})) {
          const e = store.byLabel(label)!;
          expect(
            e.roles.map((r) => ({ role: r.role, validFrom: r.validFrom, validTo: r.validTo })),
            `${fx.name} day ${step.day} roles of ${label}`,
          ).toEqual(
            roles.map((r) => ({
              role: r.role,
              validFrom: dayOf(r.validFrom),
              validTo: dayOf(r.validTo),
            })),
          );
        }
      }
    });
  }
});

const NOW = at(100);
const person = (over: Partial<CandidateEntity> & { id: string }): CandidateEntity => ({
  kind: 'person',
  canonicalLabel: over.id,
  aliases: [over.id.toLowerCase()],
  roles: [],
  lastSeenAt: NOW,
  userConfirmed: false,
  ...over,
});
const mention = (text: string, over: Partial<MentionInput> = {}): MentionInput => ({
  text,
  kind: 'person',
  relation: null,
  occurredAt: NOW,
  ...over,
});

describe('entity resolution · pronouns and empties', () => {
  it('never creates or resolves an entity from a pronoun alone', () => {
    for (const p of ['she', 'He', 'they', 'them', 'her', 'it', 'someone', 'my', 'I']) {
      const d = resolveMention(mention(p), [person({ id: 'Alex' })]);
      expect(d, p).toEqual({ kind: 'drop', reason: 'pronoun' });
    }
    expect(resolveMention(mention('   '), [])).toEqual({ kind: 'drop', reason: 'empty' });
    expect(resolveMention(mention('’s'), [])).toEqual({ kind: 'drop', reason: 'pronoun' });
  });
});

describe('entity resolution · thresholds sit on the right side of every boundary', () => {
  it('weights sum to one', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('an exact alias with no competitor auto-links regardless of recency (exact-alias dominance)', () => {
    const stale = person({ id: 'Leeds', kind: 'place', lastSeenAt: at(-800) });
    const d = resolveMention(mention('Leeds', { kind: 'place' }), [stale]);
    expect(d.kind).toBe('auto');
    if (d.kind === 'auto') expect(d.score).toBeGreaterThanOrEqual(AUTO_LINK);
    // …but not across a kind mismatch or a role contradiction.
    expect(resolveMention(mention('Leeds', { kind: 'person' }), [stale]).kind).toBe('new');
    const sibling = person({
      id: 'Sam',
      roles: [{ role: 'sibling', validFrom: '2025-01-01', validTo: null }],
    });
    const d2 = resolveMention(mention('Sam', { relation: 'partner' }), [sibling]);
    expect(d2.kind).not.toBe('auto');
  });

  it('auto needs top ≥ AUTO_LINK and a margin ≥ AUTO_MARGIN over the runner-up', () => {
    const a = person({
      id: 'Alex',
      roles: [{ role: 'friend', validFrom: '2025-01-01', validTo: null }],
    });
    const b = person({
      id: 'Alex-2',
      canonicalLabel: 'Alex',
      aliases: ['alex'],
      lastSeenAt: at(99),
      roles: [{ role: 'colleague', validFrom: '2025-06-01', validTo: null }],
    });
    const sa = scoreCandidate(mention('Alex', { relation: 'friend' }), a);
    const sb = scoreCandidate(mention('Alex', { relation: 'friend' }), b);
    expect(sa.score).toBeGreaterThanOrEqual(AUTO_LINK);
    // The runner-up is close (same name, a compatible other role): the margin decides.
    const d = resolveMention(mention('Alex', { relation: 'friend' }), [a, b]);
    expect(d.kind).toBe(sa.score - sb.score >= AUTO_MARGIN ? 'auto' : 'tentative');
    if (d.kind !== 'drop' && d.kind !== 'new') expect(d.entityId).toBe('Alex');
  });

  it('a score just under TENTATIVE creates a new entity; just over stays tentative', () => {
    // Recency and kind only: a stranger of the same kind never reaches the tentative band.
    const stranger = person({ id: 'Jordan' });
    const s = scoreCandidate(mention('Casey'), stranger);
    expect(s.signals.alias_exactness).toBe(0);
    expect(s.score).toBeLessThan(TENTATIVE);
    expect(resolveMention(mention('Casey'), [stranger]).kind).toBe('new');
    // Trigram lookalike, same kind, recent: lands inside the tentative band.
    const lookalike = person({ id: 'Sam', trigramSimilarity: TRIGRAM_MIN });
    const t = scoreCandidate(mention('Sami'), lookalike);
    expect(t.signals.alias_exactness).toBe(ALIAS_TRIGRAM);
    expect(t.score).toBeGreaterThanOrEqual(TENTATIVE);
    expect(t.score).toBeLessThan(AUTO_LINK);
    expect(resolveMention(mention('Sami'), [lookalike]).kind).toBe('tentative');
    // Under the trigram floor the channel is silent.
    const far = person({ id: 'Sam', trigramSimilarity: TRIGRAM_MIN - 0.01 });
    expect(scoreCandidate(mention('Sami'), far).signals.alias_exactness).toBe(0);
  });

  it('ambiguity: two close candidates ask only when the distinction changes history', () => {
    const friend = person({
      id: 'Alex-friend',
      canonicalLabel: 'Alex',
      aliases: ['alex'],
      roles: [{ role: 'friend', validFrom: '2025-01-01', validTo: null }],
    });
    const colleague = person({
      id: 'Alex-colleague',
      canonicalLabel: 'Alex',
      aliases: ['alex'],
      roles: [{ role: 'colleague', validFrom: '2025-01-01', validTo: null }],
    });
    const d = resolveMention(mention('Alex'), [friend, colleague]);
    expect(d.kind).toBe('ask');
    if (d.kind === 'ask') {
      expect(Math.abs(d.candidates[0].score - d.candidates[1].score)).toBeLessThan(
        AMBIGUOUS_MARGIN,
      );
      expect(d.candidates.map((c) => c.entity.id).sort()).toEqual([
        'Alex-colleague',
        'Alex-friend',
      ]);
    }
    // Same roles, no journeys, no outcomes: nothing changes → tentative and silent.
    const twinA = person({ id: 'Alex-a', canonicalLabel: 'Alex', aliases: ['alex'] });
    const twinB = person({ id: 'Alex-b', canonicalLabel: 'Alex', aliases: ['alex'] });
    expect(changesHistory(twinA, twinB, NOW)).toBe(false);
    expect(resolveMention(mention('Alex'), [twinA, twinB]).kind).toBe('tentative');
    // Differing journeys or confirmed outcomes do change history.
    expect(changesHistory({ ...twinA, journeyIds: ['j1'] }, twinB, NOW)).toBe(true);
    expect(changesHistory({ ...twinA, hasConfirmedOutcomes: true }, twinB, NOW)).toBe(true);
  });

  it('a name for a descriptor-only entity with the same role scores the naming channel', () => {
    const girlfriend = person({
      id: 'gf',
      canonicalLabel: 'my girlfriend',
      aliases: ['girlfriend'],
      roles: [{ role: 'partner', validFrom: '2026-01-01', validTo: null }],
      lastSeenAt: at(90),
    });
    const s = scoreCandidate(mention('Alex', { relation: 'partner' }), girlfriend);
    expect(s.signals.alias_exactness).toBe(ALIAS_NAMES_DESCRIPTOR);
    expect(s.signals.role_consistency).toBe(1);
    const d = resolveMention(mention('Alex', { relation: 'partner' }), [girlfriend]);
    expect(d.kind).toBe('auto');
    if (d.kind === 'auto') expect(d.namesEntity).toBe(true);
    // A different name for an entity that already has one is a different person.
    const named = person({
      id: 'Sam',
      roles: [{ role: 'partner', validFrom: '2026-01-01', validTo: null }],
    });
    expect(
      scoreCandidate(mention('Alex', { relation: 'partner' }), named).signals.alias_exactness,
    ).toBe(0);
    expect(resolveMention(mention('Alex', { relation: 'partner' }), [named]).kind).toBe('new');
  });

  it('a successor descriptor ("my ex") is a tentative match for the role holder', () => {
    const partner = person({
      id: 'Alex',
      roles: [{ role: 'partner', validFrom: '2026-01-01', validTo: null }],
      lastSeenAt: at(60),
    });
    const s = scoreCandidate(mention('my ex', { relation: 'ex-partner' }), partner);
    expect(s.signals.alias_exactness).toBe(ALIAS_ROLE_SUCCESSOR);
    expect(s.signals.role_consistency).toBe(0.8);
    const d = resolveMention(mention('my ex', { relation: 'ex-partner' }), [partner]);
    expect(d.kind).toBe('tentative');
  });

  it('the journey signal is renormalised out until journeys exist, and counts once they do', () => {
    const c = person({
      id: 'Alex',
      roles: [{ role: 'friend', validFrom: '2026-01-01', validTo: null }],
      journeyIds: ['j1'],
    });
    const without = scoreCandidate(mention('Alex', { relation: 'friend' }), c, {
      journeysExist: false,
    });
    expect(without.available).not.toContain('journey_overlap');
    const withShared = scoreCandidate(mention('Alex', { relation: 'friend' }), c, {
      journeysExist: true,
      journeyIds: ['j1'],
    });
    const withoutShared = scoreCandidate(mention('Alex', { relation: 'friend' }), c, {
      journeysExist: true,
      journeyIds: ['j2'],
    });
    expect(withShared.available).toContain('journey_overlap');
    expect(withShared.signals.journey_overlap).toBe(1);
    expect(withoutShared.signals.journey_overlap).toBe(0);
    expect(withShared.score).toBeGreaterThan(withoutShared.score);
    expect(without.signals.alias_exactness).toBe(ALIAS_EXACT);
  });

  it('reasons are human sentences that name the evidence, never numbers', () => {
    const c = person({
      id: 'Alex',
      roles: [{ role: 'friend', validFrom: '2026-01-01', validTo: null }],
      lastSeenAt: at(88),
    });
    const s = scoreCandidate(mention('Alex', { relation: 'friend' }), c);
    expect(s.reasons).toEqual([
      'You have called them “Alex” before',
      'Alex is your friend',
      'Last mentioned 12 days apart',
      'Both are people',
    ]);
    for (const r of s.reasons) expect(r).not.toMatch(/\d\.\d|%/);
  });
});
