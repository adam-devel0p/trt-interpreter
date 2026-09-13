/**
 * In-memory entity store for the `fixtures/history/` walk. Executes the same `planApply()`
 * mutations the database materialiser does, with the pure trigram mirror standing in for
 * pg_trgm, so the fixture expectations are about the resolver alone.
 */
import { planApply } from '../apply';
import { normalizeAlias } from '../normalize';
import { resolveMention, type CandidateEntity, type Decision, type MentionInput } from '../resolve';
import { planRoleChange, type RoleRow } from '../roles';
import { trigramSimilarity } from '../trigram';
import type { EntityKind } from '../../extraction/schema';

export interface SimEntity {
  id: string;
  kind: EntityKind;
  canonicalLabel: string;
  aliases: string[];
  roles: RoleRow[];
  lastSeenAt: string;
  userConfirmed: boolean;
}

export class SimStore {
  entities: SimEntity[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  candidates(m: MentionInput): CandidateEntity[] {
    const norm = normalizeAlias(m.text);
    return this.entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      canonicalLabel: e.canonicalLabel,
      aliases: e.aliases,
      roles: e.roles,
      lastSeenAt: e.lastSeenAt,
      userConfirmed: e.userConfirmed,
      trigramSimilarity: Math.max(
        trigramSimilarity(norm, normalizeAlias(e.canonicalLabel)),
        ...e.aliases.map((a) => trigramSimilarity(norm, a)),
      ),
    }));
  }

  byId(id: string): SimEntity {
    const e = this.entities.find((x) => x.id === id);
    if (!e) throw new Error(`no entity ${id}`);
    return e;
  }

  byLabel(label: string): SimEntity | undefined {
    return this.entities.find((x) => x.canonicalLabel === label);
  }

  /** Resolve and apply, as the materialiser would. Returns the decision for assertions. */
  mention(m: MentionInput): Decision {
    const decision = resolveMention(m, this.candidates(m));
    this.apply(decision, m);
    return decision;
  }

  apply(decision: Decision, m: MentionInput): void {
    const existing =
      decision.kind === 'auto' || decision.kind === 'tentative' || decision.kind === 'ask'
        ? this.byId(decision.entityId)
        : null;
    const mut = planApply(decision, m, existing);
    if (mut.createEntity) {
      const c = mut.createEntity;
      this.entities.push({
        id: this.nextId('e'),
        kind: c.kind,
        canonicalLabel: c.canonicalLabel,
        aliases: [c.alias.normalized],
        roles: c.role
          ? [
              {
                id: this.nextId('r'),
                role: c.role.role,
                validFrom: c.role.validFrom,
                validTo: null,
              },
            ]
          : [],
        lastSeenAt: m.occurredAt,
        userConfirmed: false,
      });
      return;
    }
    if (!existing) return;
    if (mut.addAlias) existing.aliases.push(mut.addAlias.normalized);
    if (mut.rename) existing.canonicalLabel = mut.rename;
    if (mut.touchLastSeen && mut.touchLastSeen > existing.lastSeenAt)
      existing.lastSeenAt = mut.touchLastSeen;
    if (mut.roles) this.applyRoles(existing, mut.roles);
  }

  private applyRoles(e: SimEntity, plan: ReturnType<typeof planRoleChange>): void {
    for (const c of plan.close) {
      const r = e.roles.find((x) => x.id === c.id)!;
      r.validTo = c.validTo;
    }
    if (plan.add)
      e.roles.push({
        id: this.nextId('r'),
        role: plan.add.role,
        validFrom: plan.add.validFrom,
        validTo: null,
      });
  }

  /** A user correction: pin the mention to an entity (adds the alias, applies the framing). */
  userLink(m: MentionInput, entityId: string): void {
    const e = this.byId(entityId);
    const norm = normalizeAlias(m.text);
    if (!e.aliases.includes(norm)) e.aliases.push(norm);
    e.userConfirmed = true;
    if (m.occurredAt > e.lastSeenAt) e.lastSeenAt = m.occurredAt;
    const decision = resolveMention(m, []);
    const role = decision.kind === 'new' ? decision.role : null;
    if (role) this.applyRoles(e, planRoleChange(e.roles, role.role, m.occurredAt));
  }

  /** A user-created entity (the result of a split, or a manual add). */
  userCreate(label: string, kind: EntityKind, roles: string[], at: string): SimEntity {
    const e: SimEntity = {
      id: this.nextId('e'),
      kind,
      canonicalLabel: label,
      aliases: [normalizeAlias(label)],
      roles: roles.map((role) => ({
        id: this.nextId('r'),
        role,
        validFrom: at.slice(0, 10),
        validTo: null,
      })),
      lastSeenAt: at,
      userConfirmed: true,
    };
    this.entities.push(e);
    return e;
  }
}
