/**
 * From a resolution `Decision` to the entity-side mutations it implies. Pure, so the database
 * materialiser and the fixture simulator execute exactly the same plan:
 *
 *   new        → create the entity with the mention as label and alias (+ a role if framed)
 *   auto       → record the surface form as an alias, bump last_seen, rename a descriptor-only
 *                entity when a proper name arrived, apply a role change if the framing says so
 *   tentative  → touch nothing on the entity (a tentative link must not reinforce itself)
 *   ask        → as tentative, plus the two candidates for the user
 *   drop       → nothing
 */
import type { EntityKind } from '../extraction/schema';
import { normalizeAlias } from './normalize';
import type { Decision, MentionInput, Signals } from './resolve';
import { planRoleChange, type RolePlan, type RoleRow } from './roles';

export interface MentionWrite {
  text: string;
  normalized: string;
  resolution: 'auto' | 'tentative';
  confidence: number;
  signals: Signals | null;
  reasons: string[];
  askCandidates: string[] | null;
}

export interface EntityMutation {
  createEntity: {
    canonicalLabel: string;
    kind: EntityKind;
    alias: { alias: string; normalized: string; context: string | null };
    role: { role: string; validFrom: string } | null;
  } | null;
  /** The existing entity the mention resolved to (null when creating). */
  entityId: string | null;
  addAlias: { alias: string; normalized: string; context: string | null } | null;
  rename: string | null;
  roles: RolePlan | null;
  touchLastSeen: string | null;
  mention: MentionWrite | null;
}

const NOTHING: EntityMutation = {
  createEntity: null,
  entityId: null,
  addAlias: null,
  rename: null,
  roles: null,
  touchLastSeen: null,
  mention: null,
};

export function planApply(
  decision: Decision,
  m: MentionInput,
  existing: { aliases: readonly string[]; roles: readonly RoleRow[] } | null,
): EntityMutation {
  const text = m.text.trim();
  const normalized = normalizeAlias(text);
  switch (decision.kind) {
    case 'drop':
      return NOTHING;
    case 'new':
      return {
        ...NOTHING,
        createEntity: {
          canonicalLabel: decision.canonicalLabel,
          kind: decision.entityKind,
          alias: { alias: text, normalized, context: decision.role?.role ?? null },
          role: decision.role
            ? { role: decision.role.role, validFrom: m.occurredAt.slice(0, 10) }
            : null,
        },
        mention: {
          text,
          normalized,
          resolution: 'auto',
          confidence: 1,
          signals: null,
          reasons: ['First mention'],
          askCandidates: null,
        },
      };
    case 'auto': {
      const hasAlias = existing?.aliases.includes(normalized) ?? false;
      const roles =
        decision.role && existing
          ? planRoleChange(existing.roles, decision.role.role, m.occurredAt)
          : null;
      return {
        ...NOTHING,
        entityId: decision.entityId,
        addAlias: hasAlias
          ? null
          : { alias: text, normalized, context: decision.role?.role ?? null },
        rename: decision.namesEntity ? text : null,
        roles: roles && (roles.add || roles.close.length) ? roles : null,
        touchLastSeen: m.occurredAt,
        mention: {
          text,
          normalized,
          resolution: 'auto',
          confidence: decision.score,
          signals: decision.signals,
          reasons: decision.reasons,
          askCandidates: null,
        },
      };
    }
    case 'tentative':
      return {
        ...NOTHING,
        entityId: decision.entityId,
        mention: {
          text,
          normalized,
          resolution: 'tentative',
          confidence: decision.score,
          signals: decision.signals,
          reasons: decision.reasons,
          askCandidates: null,
        },
      };
    case 'ask':
      return {
        ...NOTHING,
        entityId: decision.entityId,
        mention: {
          text,
          normalized,
          resolution: 'tentative',
          confidence: decision.score,
          signals: decision.signals,
          reasons: decision.reasons,
          askCandidates: decision.candidates.map((c) => c.entity.id),
        },
      };
  }
}
