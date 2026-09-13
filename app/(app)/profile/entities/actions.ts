'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import {
  addAlias,
  addRole,
  closeRole,
  deleteEntity,
  ENTITY_LABEL_MAX,
  ENTITY_NOTES_MAX,
  mergeEntities,
  removeAlias,
  renameEntity,
  ROLE_KEYS,
  setEntityNotes,
  splitEntity,
  undoMerge,
} from '@/db/queries/memory';
import { ENTITY_KINDS } from '@/domain/extraction/schema';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Entity corrections (FR-27): rename, notes, aliases, roles, merge / undo / split, remove.
 * Every write runs as the user through RLS; merges and splits are one transaction each
 * (`apply_entity_merge`, `apply_entity_split`). Any correction pins the entity. No model.
 */
export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const FAILED = "That didn't go through. Nothing changed — try again.";
const uuid = z.string().uuid();

function done(entityId: string) {
  revalidatePath('/profile/entities');
  revalidatePath(`/profile/entities/${entityId}`);
  revalidatePath('/journal');
}

async function run<T = undefined>(
  event: string,
  entityId: unknown,
  fn: (
    client: Awaited<ReturnType<typeof getSessionClient>>,
    userId: string,
    id: string,
  ) => Promise<T | void>,
): Promise<ActionResult<T>> {
  const user = await requireUser();
  const id = uuid.safeParse(entityId);
  if (!id.success) return { ok: false, message: FAILED };
  try {
    const value = (await fn(await getSessionClient(), user.id, id.data)) as T;
    logger.info(`app.entity.${event}`, {
      userId: user.id,
      objectType: 'entity',
      objectId: id.data,
    });
    done(id.data);
    return { ok: true, value };
  } catch (err) {
    logger.warn(`app.entity.${event}_failed`, {
      userId: user.id,
      objectId: id.data,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: FAILED };
  }
}

export async function renameEntityAction(entityId: unknown, label: unknown): Promise<ActionResult> {
  const l = z.string().trim().min(1).max(ENTITY_LABEL_MAX).safeParse(label);
  if (!l.success) return { ok: false, message: 'Give it a name (up to 120 characters).' };
  return run<undefined>('renamed', entityId, (c, _u, id) => renameEntity(c, id, l.data));
}

export async function setEntityNotesAction(
  entityId: unknown,
  notes: unknown,
): Promise<ActionResult> {
  const n = z.string().max(ENTITY_NOTES_MAX).nullable().safeParse(notes);
  if (!n.success) return { ok: false, message: 'That note is too long to save.' };
  return run<undefined>('notes', entityId, (c, _u, id) => setEntityNotes(c, id, n.data));
}

export async function addAliasAction(entityId: unknown, alias: unknown): Promise<ActionResult> {
  const a = z.string().trim().min(1).max(ENTITY_LABEL_MAX).safeParse(alias);
  if (!a.success) return { ok: false, message: 'Type the name or phrase you use for them.' };
  return run<undefined>('alias_added', entityId, (c, u, id) => addAlias(c, u, id, a.data));
}

export async function removeAliasAction(
  entityId: unknown,
  aliasId: unknown,
): Promise<ActionResult> {
  const a = uuid.safeParse(aliasId);
  if (!a.success) return { ok: false, message: FAILED };
  return run<undefined>('alias_removed', entityId, (c) => removeAlias(c, a.data));
}

export async function addRoleAction(
  entityId: unknown,
  role: unknown,
  validFrom: unknown,
): Promise<ActionResult> {
  const r = z.enum(ROLE_KEYS).safeParse(role);
  const from = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(validFrom);
  if (!r.success || !from.success) return { ok: false, message: 'Pick a role and a start date.' };
  return run<undefined>('role_added', entityId, (c, u, id) => addRole(c, u, id, r.data, from.data));
}

export async function closeRoleAction(
  entityId: unknown,
  roleId: unknown,
  validTo: unknown,
): Promise<ActionResult> {
  const rid = uuid.safeParse(roleId);
  const to = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(validTo);
  if (!rid.success || !to.success) return { ok: false, message: 'Pick an end date.' };
  return run<undefined>('role_closed', entityId, (c) => closeRole(c, rid.data, to.data));
}

export async function mergeEntitiesAction(
  sourceId: unknown,
  targetId: unknown,
): Promise<ActionResult<{ mergeId: string; movedMentions: number; keptRoles: number }>> {
  const t = uuid.safeParse(targetId);
  if (!t.success) return { ok: false, message: 'Pick who to merge into.' };
  const res = await run('merged', sourceId, (c, _u, id) => mergeEntities(c, id, t.data));
  if (res.ok) done(t.data);
  return res;
}

export async function undoMergeAction(entityId: unknown, mergeId: unknown): Promise<ActionResult> {
  const m = uuid.safeParse(mergeId);
  if (!m.success) return { ok: false, message: FAILED };
  return run<undefined>('merge_undone', entityId, (c) => undoMerge(c, m.data));
}

export async function splitEntityAction(
  entityId: unknown,
  mentionIds: unknown,
  label: unknown,
  kind: unknown,
): Promise<ActionResult<{ id: string; movedMentions: number }>> {
  const ids = z.array(uuid).min(1).safeParse(mentionIds);
  const l = z.string().trim().min(1).max(ENTITY_LABEL_MAX).safeParse(label);
  const k = z.enum(ENTITY_KINDS).safeParse(kind);
  if (!ids.success || !l.success || !k.success)
    return { ok: false, message: 'Choose at least one mention and give the new entry a name.' };
  return run('split', entityId, (c, _u, id) => splitEntity(c, id, ids.data, l.data, k.data));
}

export async function deleteEntityAction(entityId: unknown): Promise<ActionResult> {
  const res = await run('deleted', entityId, async (c, _u, id) => {
    const gone = await deleteEntity(c, id);
    if (!gone) throw new Error('not found');
  });
  if (!res.ok) return res;
  redirect('/profile/entities');
}
