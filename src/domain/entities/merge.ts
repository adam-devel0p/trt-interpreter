/**
 * Merge and split planning (FR-27; docs/ALGORITHMS.md#corrections-fr-27). Pure: given the rows
 * of both entities, decide what moves. The database module executes the plan and writes a
 * receipt so it can be undone.
 *
 * Roles are never merged blindly: every role row moves, and rows with the same role but
 * different date ranges stay as separate rows — two histories kept, not one overwritten.
 * Only a row identical in (role, valid_from, valid_to) to one the target already has is
 * dropped as a duplicate.
 */
import type { RoleRow } from './roles';

export interface AliasRow {
  id: string;
  aliasNormalized: string;
}
export interface MentionRow {
  id: string;
  mentionNormalized: string;
  objectType: string;
  objectId: string;
}

export interface EntitySide {
  id: string;
  aliases: readonly AliasRow[];
  mentions: readonly MentionRow[];
  roles: readonly RoleRow[];
}

export interface MergePlan {
  /** Alias ids to re-point at the target. */
  moveAliases: string[];
  /** Alias ids the target already has (dropped; nothing lost — the same normalised form). */
  dropAliases: string[];
  moveMentions: string[];
  /** Mentions of the same normalised text on the same object as one the target has: dropped. */
  dropMentions: string[];
  moveRoles: string[];
  dropRoles: string[];
}

export function planMerge(source: EntitySide, target: EntitySide): MergePlan {
  if (source.id === target.id) throw new Error('cannot merge an entity into itself');
  const targetAliases = new Set(target.aliases.map((a) => a.aliasNormalized));
  const targetMentions = new Set(
    target.mentions.map((m) => `${m.objectType}:${m.objectId}:${m.mentionNormalized}`),
  );
  const targetRoles = new Set(target.roles.map((r) => `${r.role}|${r.validFrom}|${r.validTo}`));
  const plan: MergePlan = {
    moveAliases: [],
    dropAliases: [],
    moveMentions: [],
    dropMentions: [],
    moveRoles: [],
    dropRoles: [],
  };
  for (const a of source.aliases)
    (targetAliases.has(a.aliasNormalized) ? plan.dropAliases : plan.moveAliases).push(a.id);
  for (const m of source.mentions)
    (targetMentions.has(`${m.objectType}:${m.objectId}:${m.mentionNormalized}`)
      ? plan.dropMentions
      : plan.moveMentions
    ).push(m.id);
  for (const r of source.roles)
    (targetRoles.has(`${r.role}|${r.validFrom}|${r.validTo}`)
      ? plan.dropRoles
      : plan.moveRoles
    ).push(r.id);
  return plan;
}

export interface SplitPlan {
  /** Mentions that go to the new entity. */
  moveMentions: string[];
  /** Aliases no remaining mention of the source uses: they follow the moved mentions. */
  moveAliases: string[];
  /** Aliases used by both sides: copied to the new entity. */
  copyAliases: string[];
}

/** Split: the user picked which mentions belong to someone else. */
export function planSplit(source: EntitySide, mentionIds: readonly string[]): SplitPlan {
  const moving = new Set(mentionIds);
  const moved = source.mentions.filter((m) => moving.has(m.id));
  if (moved.length === 0) throw new Error('nothing to split');
  if (moved.length === source.mentions.length) throw new Error('cannot move every mention');
  const stayingForms = new Set(
    source.mentions.filter((m) => !moving.has(m.id)).map((m) => m.mentionNormalized),
  );
  const movedForms = new Set(moved.map((m) => m.mentionNormalized));
  const plan: SplitPlan = {
    moveMentions: moved.map((m) => m.id),
    moveAliases: [],
    copyAliases: [],
  };
  for (const a of source.aliases) {
    if (!movedForms.has(a.aliasNormalized)) continue;
    (stayingForms.has(a.aliasNormalized) ? plan.copyAliases : plan.moveAliases).push(a.id);
  }
  return plan;
}
