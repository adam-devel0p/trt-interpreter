/**
 * Structured memory through the RLS-respecting user client (Phase 06). Reads for the reading
 * detail and the entities pages; writes for every user correction: overrides, renames,
 * aliases, roles, merge / undo / split. Nothing here talks to a model — the detail screen
 * renders stored rows (invariant: opening a reading makes zero AI calls); the extraction job
 * writes through `src/memory/` with the service role.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { planMerge, planSplit } from '@/domain/entities/merge';
import { normalizeAlias } from '@/domain/entities/normalize';
import { roleForRelation, RELATION_ROLES } from '@/domain/entities/relations';
import {
  applyOverrides,
  overrideValueSchema,
  parseOverride,
  type EffectiveMetadata,
  type Override,
  type OverrideValue,
} from '@/domain/extraction/overrides';
import { sourceHash } from '@/domain/extraction/hash';
import {
  ENTITY_KINDS,
  extractionPayloadSchema,
  type EntityKind,
  type ExtractionPayload,
} from '@/domain/extraction/schema';

export class MemoryQueryError extends Error {
  override name = 'MemoryQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const fail = (what: string, error: { code?: string } | null): never => {
  throw new MemoryQueryError(`${what} failed`, error?.code);
};

// ── Reading detail ─────────────────────────────────────────────────────────────────────────

export interface ExtractionMeta {
  id: string;
  status: 'pending' | 'complete' | 'failed';
  schema_version: string;
  prompt_version: string;
  model_id: string | null;
  metadata_version: number;
  source_hash: string;
  error_class: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface EntityRef {
  id: string;
  canonical_label: string;
  kind: EntityKind;
  user_confirmed: boolean;
  status: string;
  /** Active roles, for the disambiguation question. */
  roles: string[];
}

export interface MentionView {
  id: string;
  entity_id: string;
  mention_text: string;
  mention_normalized: string;
  confidence: number;
  resolution: 'auto' | 'tentative' | 'user' | 'rejected';
  reasons: string[];
  ask_candidates: string[] | null;
  entity: EntityRef;
  /** Resolved candidates when a question is open. */
  ask_options: EntityRef[];
}

export interface ThemeView {
  id: string;
  theme_id: string;
  slug: string;
  label: string;
  category: string;
  weight: number;
  source: 'user' | 'model' | 'rule';
  user_confirmed: boolean;
}

export interface PredictionView {
  id: string;
  text: string;
  text_hash: string;
  category: string | null;
  timeframe_text: string | null;
  kind: 'possibility' | 'prediction';
  fact_status: 'POSSIBILITY';
  user_edited: boolean;
  dismissed_at: string | null;
}

export interface ReadingMemory {
  /** The newest run of any status that is not superseded; null when nothing ran yet. */
  latest: ExtractionMeta | null;
  /** The current complete payload, with overrides applied. */
  effective: EffectiveMetadata | null;
  overrides: Override[];
  mentions: MentionView[];
  themes: ThemeView[];
  predictions: PredictionView[];
  /** The current extraction read older text or cards than the reading has now. */
  stale: boolean;
}

const EXTRACTION_COLUMNS =
  'id, status, schema_version, prompt_version, model_id, metadata_version, source_hash, error_class, created_at, completed_at, payload, superseded_by';

interface RawEntityRef {
  id: string;
  canonical_label: string;
  kind: EntityKind;
  user_confirmed: boolean;
  status: string;
  entity_roles: { role: string; valid_to: string | null }[] | null;
}

const ENTITY_REF_SELECT =
  'id, canonical_label, kind, user_confirmed, status, entity_roles(role, valid_to)';

function toEntityRef(raw: RawEntityRef): EntityRef {
  return {
    id: raw.id,
    canonical_label: raw.canonical_label,
    kind: raw.kind,
    user_confirmed: raw.user_confirmed,
    status: raw.status,
    roles: (raw.entity_roles ?? []).filter((r) => r.valid_to === null).map((r) => r.role),
  };
}

export async function getReadingMemory(
  client: UserClient,
  reading: {
    id: string;
    metadata_version: number;
    question: string | null;
    user_notes: string | null;
  },
): Promise<ReadingMemory> {
  const [ext, ovr, men, thm, prd] = await Promise.all([
    client
      .from('extractions')
      .select(EXTRACTION_COLUMNS)
      .eq('object_type', 'reading')
      .eq('object_id', reading.id)
      .is('superseded_by', null)
      .order('created_at', { ascending: false })
      .limit(5),
    client
      .from('metadata_overrides')
      .select('field_path, value')
      .eq('object_type', 'reading')
      .eq('object_id', reading.id),
    client
      .from('entity_mentions')
      .select(
        `id, entity_id, mention_text, mention_normalized, confidence, resolution, reasons, ask_candidates, entities(${ENTITY_REF_SELECT})`,
      )
      .eq('object_type', 'reading')
      .eq('object_id', reading.id)
      .order('created_at', { ascending: true }),
    client
      .from('object_themes')
      .select('id, theme_id, weight, source, user_confirmed, themes(slug, label, category)')
      .eq('object_type', 'reading')
      .eq('object_id', reading.id)
      .order('weight', { ascending: false }),
    client
      .from('predictions')
      .select(
        'id, text, text_hash, category, timeframe_text, kind, fact_status, user_edited, dismissed_at',
      )
      .eq('reading_id', reading.id)
      .order('created_at', { ascending: true }),
  ]);
  if (ext.error) fail('extraction read', ext.error);
  if (ovr.error) fail('overrides read', ovr.error);
  if (men.error) fail('mentions read', men.error);
  if (thm.error) fail('themes read', thm.error);
  if (prd.error) fail('predictions read', prd.error);

  type RawExt = ExtractionMeta & { payload: unknown; superseded_by: string | null };
  const rows = (ext.data ?? []) as unknown as RawExt[];
  const latestRaw = rows[0] ?? null;
  const currentRaw = rows.find((r) => r.status === 'complete') ?? null;
  const overrides = ((ovr.data ?? []) as { field_path: string; value: unknown }[])
    .map((r) => parseOverride(r.field_path, r.value))
    .filter((o): o is Override => !!o);
  let effective: EffectiveMetadata | null = null;
  if (currentRaw) {
    const parsed = extractionPayloadSchema.safeParse(currentRaw.payload);
    if (parsed.success) effective = applyOverrides(parsed.data, overrides);
  }
  const stale =
    !!currentRaw &&
    (currentRaw.metadata_version !== reading.metadata_version ||
      currentRaw.source_hash !== sourceHash(reading.question, reading.user_notes));

  type RawMention = Omit<MentionView, 'entity' | 'ask_options' | 'confidence' | 'reasons'> & {
    confidence: string | number;
    reasons: string[] | null;
    entities: RawEntityRef;
  };
  const rawMentions = (men.data ?? []) as unknown as RawMention[];
  const askIds = [...new Set(rawMentions.flatMap((m) => m.ask_candidates ?? []))];
  let askRefs = new Map<string, EntityRef>();
  if (askIds.length) {
    const cand = await client.from('entities').select(ENTITY_REF_SELECT).in('id', askIds);
    if (cand.error) fail('candidates read', cand.error);
    askRefs = new Map(
      ((cand.data ?? []) as unknown as RawEntityRef[]).map((r) => [r.id, toEntityRef(r)]),
    );
  }
  const mentions: MentionView[] = rawMentions
    .filter((m) => m.entities)
    .map((m) => ({
      id: m.id,
      entity_id: m.entity_id,
      mention_text: m.mention_text,
      mention_normalized: m.mention_normalized,
      confidence: Number(m.confidence),
      resolution: m.resolution,
      reasons: m.reasons ?? [],
      ask_candidates: m.ask_candidates,
      entity: toEntityRef(m.entities),
      ask_options: (m.ask_candidates ?? [])
        .map((id) => askRefs.get(id))
        .filter((r): r is EntityRef => !!r),
    }));

  type RawTheme = Omit<ThemeView, 'slug' | 'label' | 'category' | 'weight'> & {
    weight: string | number;
    themes: { slug: string; label: string; category: string };
  };
  const themes: ThemeView[] = ((thm.data ?? []) as unknown as RawTheme[]).map((t) => ({
    id: t.id,
    theme_id: t.theme_id,
    slug: t.themes.slug,
    label: t.themes.label,
    category: t.themes.category,
    weight: Number(t.weight),
    source: t.source,
    user_confirmed: t.user_confirmed,
  }));

  const { payload: _p, superseded_by: _s, ...latest } = latestRaw ?? ({} as RawExt);
  return {
    latest: latestRaw ? (latest as ExtractionMeta) : null,
    effective,
    overrides,
    mentions,
    themes,
    predictions: (prd.data ?? []) as unknown as PredictionView[],
    stale,
  };
}

/** Every stored extraction for a reading, newest first (the "earlier runs" disclosure). */
export async function listExtractions(
  client: UserClient,
  readingId: string,
): Promise<ExtractionMeta[]> {
  const { data, error } = await client
    .from('extractions')
    .select(
      'id, status, schema_version, prompt_version, model_id, metadata_version, source_hash, error_class, created_at, completed_at',
    )
    .eq('object_type', 'reading')
    .eq('object_id', readingId)
    .order('created_at', { ascending: false });
  if (error) fail('extractions read', error);
  return (data ?? []) as unknown as ExtractionMeta[];
}

// ── Overrides (FR-26) ──────────────────────────────────────────────────────────────────────

export async function upsertOverride(
  client: UserClient,
  userId: string,
  objectId: string,
  fieldPath: string,
  value: OverrideValue,
  objectType: 'reading' | 'life_event' = 'reading',
): Promise<void> {
  const parsed = overrideValueSchema.parse(value);
  const { error } = await client.from('metadata_overrides').upsert(
    {
      user_id: userId,
      object_type: objectType,
      object_id: objectId,
      field_path: fieldPath,
      value: parsed,
    },
    { onConflict: 'object_type,object_id,field_path' },
  );
  if (error) fail('override write', error);
}

export async function deleteOverride(
  client: UserClient,
  objectId: string,
  fieldPath: string,
  objectType: 'reading' | 'life_event' = 'reading',
): Promise<void> {
  const { error } = await client
    .from('metadata_overrides')
    .delete()
    .eq('object_type', objectType)
    .eq('object_id', objectId)
    .eq('field_path', fieldPath);
  if (error) fail('override delete', error);
}

// ── Entities ───────────────────────────────────────────────────────────────────────────────

export interface EntityListItem {
  id: string;
  kind: EntityKind;
  canonical_label: string;
  status: string;
  user_confirmed: boolean;
  first_seen_at: string;
  last_seen_at: string;
  alias_count: number;
  reading_count: number;
  /** Active roles. */
  roles: string[];
}

export async function listEntities(
  client: UserClient,
  opts: { includeMerged?: boolean } = {},
): Promise<EntityListItem[]> {
  let q = client
    .from('entities')
    .select(
      'id, kind, canonical_label, status, user_confirmed, first_seen_at, last_seen_at, entity_aliases(id), entity_mentions(object_type, object_id, resolution), entity_roles(role, valid_to)',
    )
    .order('last_seen_at', { ascending: false });
  if (!opts.includeMerged) q = q.eq('status', 'active');
  const { data, error } = await q;
  if (error) fail('entities read', error);
  type Raw = Omit<EntityListItem, 'alias_count' | 'reading_count' | 'roles'> & {
    entity_aliases: { id: string }[] | null;
    entity_mentions: { object_type: string; object_id: string; resolution: string }[] | null;
    entity_roles: { role: string; valid_to: string | null }[] | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    canonical_label: r.canonical_label,
    status: r.status,
    user_confirmed: r.user_confirmed,
    first_seen_at: r.first_seen_at,
    last_seen_at: r.last_seen_at,
    alias_count: r.entity_aliases?.length ?? 0,
    reading_count: new Set(
      (r.entity_mentions ?? [])
        .filter((m) => m.object_type === 'reading' && m.resolution !== 'rejected')
        .map((m) => m.object_id),
    ).size,
    roles: (r.entity_roles ?? []).filter((x) => x.valid_to === null).map((x) => x.role),
  }));
}

export interface EntityAliasView {
  id: string;
  alias: string;
  alias_normalized: string;
  context: string | null;
  confidence: number;
  source: 'user' | 'model' | 'rule';
  created_at: string;
}
export interface EntityRoleView {
  id: string;
  role: string;
  valid_from: string;
  valid_to: string | null;
  source: 'user' | 'model' | 'rule';
  evidence_object_type: string | null;
  evidence_object_id: string | null;
}
export interface EntityMentionView {
  id: string;
  object_type: string;
  object_id: string;
  mention_text: string;
  mention_normalized: string;
  confidence: number;
  resolution: 'auto' | 'tentative' | 'user' | 'rejected';
  reasons: string[];
  created_at: string;
  /** The reading it came from (RLS-scoped; null if the reading is gone). */
  reading: {
    id: string;
    question: string | null;
    is_open_reflection: boolean;
    occurred_at: string;
  } | null;
}
export interface EntityMergeView {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  merged_at: string;
  undone_at: string | null;
}

export interface EntityDetail {
  id: string;
  kind: EntityKind;
  canonical_label: string;
  status: string;
  merged_into_id: string | null;
  user_confirmed: boolean;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  aliases: EntityAliasView[];
  roles: EntityRoleView[];
  mentions: EntityMentionView[];
  /** Merges into this entity that can still be undone. */
  merges: EntityMergeView[];
}

export async function getEntity(client: UserClient, id: string): Promise<EntityDetail | null> {
  const { data, error } = await client
    .from('entities')
    .select(
      'id, kind, canonical_label, status, merged_into_id, user_confirmed, notes, first_seen_at, last_seen_at, ' +
        'entity_aliases(id, alias, alias_normalized, context, confidence, source, created_at), ' +
        'entity_roles(id, role, valid_from, valid_to, source, evidence_object_type, evidence_object_id), ' +
        'entity_mentions(id, object_type, object_id, mention_text, mention_normalized, confidence, resolution, reasons, created_at)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) fail('entity read', error);
  if (!data) return null;
  type Raw = Omit<EntityDetail, 'aliases' | 'roles' | 'mentions' | 'merges'> & {
    entity_aliases: (Omit<EntityAliasView, 'confidence'> & { confidence: string | number })[];
    entity_roles: EntityRoleView[];
    entity_mentions: (Omit<EntityMentionView, 'reading' | 'confidence' | 'reasons'> & {
      confidence: string | number;
      reasons: string[] | null;
    })[];
  };
  const raw = data as unknown as Raw;
  const readingIds = [
    ...new Set(
      raw.entity_mentions.filter((m) => m.object_type === 'reading').map((m) => m.object_id),
    ),
  ];
  const readingsById = new Map<string, EntityMentionView['reading']>();
  if (readingIds.length) {
    const r = await client
      .from('readings')
      .select('id, question, is_open_reflection, occurred_at')
      .in('id', readingIds)
      .is('deleted_at', null);
    if (r.error) fail('mention readings read', r.error);
    for (const row of (r.data ?? []) as NonNullable<EntityMentionView['reading']>[])
      readingsById.set(row.id, row);
  }
  const merges = await client
    .from('entity_merges')
    .select('id, source_entity_id, target_entity_id, merged_at, undone_at')
    .eq('target_entity_id', id)
    .is('undone_at', null)
    .order('merged_at', { ascending: false });
  if (merges.error) fail('merges read', merges.error);
  return {
    id: raw.id,
    kind: raw.kind,
    canonical_label: raw.canonical_label,
    status: raw.status,
    merged_into_id: raw.merged_into_id,
    user_confirmed: raw.user_confirmed,
    notes: raw.notes,
    first_seen_at: raw.first_seen_at,
    last_seen_at: raw.last_seen_at,
    aliases: raw.entity_aliases
      .map((a) => ({ ...a, confidence: Number(a.confidence) }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    roles: [...raw.entity_roles].sort((a, b) => b.valid_from.localeCompare(a.valid_from)),
    mentions: raw.entity_mentions
      .map((m) => ({
        ...m,
        confidence: Number(m.confidence),
        reasons: m.reasons ?? [],
        reading: m.object_type === 'reading' ? (readingsById.get(m.object_id) ?? null) : null,
      }))
      .sort((a, b) => (b.reading?.occurred_at ?? '').localeCompare(a.reading?.occurred_at ?? '')),
    merges: (merges.data ?? []) as EntityMergeView[],
  };
}

export const ENTITY_LABEL_MAX = 120;
export const ENTITY_NOTES_MAX = 1000;

export async function renameEntity(client: UserClient, id: string, label: string): Promise<void> {
  const clean = z.string().trim().min(1).max(ENTITY_LABEL_MAX).parse(label);
  const { error, data } = await client
    .from('entities')
    .update({ canonical_label: clean, user_confirmed: true })
    .eq('id', id)
    .select('id');
  if (error) fail('entity rename', error);
  if (!data?.length) throw new MemoryQueryError('entity not found', 'P0002');
}

export async function setEntityNotes(
  client: UserClient,
  id: string,
  notes: string | null,
): Promise<void> {
  const clean = z.string().max(ENTITY_NOTES_MAX).nullable().parse(notes);
  const { error } = await client
    .from('entities')
    .update({ notes: clean?.trim() || null })
    .eq('id', id);
  if (error) fail('entity notes', error);
}

export async function createEntity(
  client: UserClient,
  userId: string,
  input: { label: string; kind: EntityKind; alias?: string },
): Promise<{ id: string }> {
  const label = z.string().trim().min(1).max(ENTITY_LABEL_MAX).parse(input.label);
  const kind = z.enum(ENTITY_KINDS).parse(input.kind);
  const { data, error } = await client
    .from('entities')
    .insert({ user_id: userId, kind, canonical_label: label, user_confirmed: true })
    .select('id')
    .single();
  if (error || !data) return fail('entity create', error);
  const id = (data as { id: string }).id;
  const aliases = new Set([label, input.alias].filter((a): a is string => !!a));
  for (const alias of aliases) await addAlias(client, userId, id, alias);
  return { id };
}

export async function addAlias(
  client: UserClient,
  userId: string,
  entityId: string,
  alias: string,
  context: string | null = null,
): Promise<void> {
  const clean = z.string().trim().min(1).max(ENTITY_LABEL_MAX).parse(alias);
  const normalized = normalizeAlias(clean);
  if (!normalized) throw new MemoryQueryError('alias is empty after normalisation', '22023');
  const { error } = await client.from('entity_aliases').upsert(
    {
      user_id: userId,
      entity_id: entityId,
      alias: clean,
      alias_normalized: normalized,
      context,
      confidence: 1,
      source: 'user',
    },
    { onConflict: 'entity_id,alias_normalized' },
  );
  if (error) fail('alias add', error);
  await client.from('entities').update({ user_confirmed: true }).eq('id', entityId);
}

export async function removeAlias(client: UserClient, aliasId: string): Promise<void> {
  const { error } = await client.from('entity_aliases').delete().eq('id', aliasId);
  if (error) fail('alias remove', error);
}

export const ROLE_KEYS = RELATION_ROLES.map((r) => r.role) as [string, ...string[]];

/** Add a role from `validFrom`; a compatible active role is closed the day before. */
export async function addRole(
  client: UserClient,
  userId: string,
  entityId: string,
  role: string,
  validFrom: string,
): Promise<void> {
  const r = z.enum(ROLE_KEYS).parse(role);
  const from = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(validFrom);
  const { planRoleChange } = await import('@/domain/entities/roles');
  const existing = await client
    .from('entity_roles')
    .select('id, role, valid_from, valid_to')
    .eq('entity_id', entityId);
  if (existing.error) fail('roles read', existing.error);
  const plan = planRoleChange(
    (
      (existing.data ?? []) as {
        id: string;
        role: string;
        valid_from: string;
        valid_to: string | null;
      }[]
    ).map((x) => ({ id: x.id, role: x.role, validFrom: x.valid_from, validTo: x.valid_to })),
    r,
    `${from}T12:00:00Z`,
  );
  for (const c of plan.close) await closeRole(client, c.id, c.validTo);
  if (plan.add) {
    const { error } = await client.from('entity_roles').insert({
      user_id: userId,
      entity_id: entityId,
      role: plan.add.role,
      valid_from: plan.add.validFrom,
      valid_to: null,
      source: 'user',
    });
    if (error) fail('role add', error);
  }
  await client.from('entities').update({ user_confirmed: true }).eq('id', entityId);
}

/** Close a role (its only permitted edit: the `entity_roles_immutable` trigger enforces it). */
export async function closeRole(
  client: UserClient,
  roleId: string,
  validTo: string,
): Promise<void> {
  const to = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(validTo);
  const { error } = await client.from('entity_roles').update({ valid_to: to }).eq('id', roleId);
  if (error) fail('role close', error);
}

async function loadSide(client: UserClient, id: string) {
  const { data, error } = await client
    .from('entities')
    .select(
      'id, status, entity_aliases(id, alias_normalized), entity_mentions(id, mention_normalized, object_type, object_id), entity_roles(id, role, valid_from, valid_to)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) fail('entity read', error);
  if (!data) throw new MemoryQueryError('entity not found', 'P0002');
  const raw = data as unknown as {
    id: string;
    status: string;
    entity_aliases: { id: string; alias_normalized: string }[];
    entity_mentions: {
      id: string;
      mention_normalized: string;
      object_type: string;
      object_id: string;
    }[];
    entity_roles: { id: string; role: string; valid_from: string; valid_to: string | null }[];
  };
  if (raw.status !== 'active') throw new MemoryQueryError('entity is not active', '22023');
  return {
    id: raw.id,
    aliases: raw.entity_aliases.map((a) => ({ id: a.id, aliasNormalized: a.alias_normalized })),
    mentions: raw.entity_mentions.map((m) => ({
      id: m.id,
      mentionNormalized: m.mention_normalized,
      objectType: m.object_type,
      objectId: m.object_id,
    })),
    roles: raw.entity_roles.map((r) => ({
      id: r.id,
      role: r.role,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    })),
  };
}

/** Merge `sourceId` into `targetId` (FR-27). Plan in the domain, execute atomically as the user. */
export async function mergeEntities(
  client: UserClient,
  sourceId: string,
  targetId: string,
): Promise<{ mergeId: string; movedMentions: number; keptRoles: number }> {
  const [source, target] = await Promise.all([
    loadSide(client, sourceId),
    loadSide(client, targetId),
  ]);
  const plan = planMerge(source, target);
  const { data, error } = await client.rpc('apply_entity_merge', {
    p_source: sourceId,
    p_target: targetId,
    p_plan: {
      move_aliases: plan.moveAliases,
      drop_aliases: plan.dropAliases,
      move_mentions: plan.moveMentions,
      drop_mentions: plan.dropMentions,
      move_roles: plan.moveRoles,
      drop_roles: plan.dropRoles,
    },
  });
  if (error) fail('merge', error);
  return {
    mergeId: data as string,
    movedMentions: plan.moveMentions.length,
    keptRoles: plan.moveRoles.length,
  };
}

export async function undoMerge(client: UserClient, mergeId: string): Promise<void> {
  const { error } = await client.rpc('undo_entity_merge', { p_merge: mergeId });
  if (error) fail('undo merge', error);
}

/** Split: the chosen mentions become a new entity named `label` (FR-27). */
export async function splitEntity(
  client: UserClient,
  sourceId: string,
  mentionIds: string[],
  label: string,
  kind: EntityKind,
): Promise<{ id: string; movedMentions: number }> {
  const clean = z.string().trim().min(1).max(ENTITY_LABEL_MAX).parse(label);
  const source = await loadSide(client, sourceId);
  const plan = planSplit(source, mentionIds);
  const { data, error } = await client.rpc('apply_entity_split', {
    p_source: sourceId,
    p_label: clean,
    p_kind: z.enum(ENTITY_KINDS).parse(kind),
    p_plan: {
      move_mentions: plan.moveMentions,
      move_aliases: plan.moveAliases,
      copy_aliases: plan.copyAliases,
    },
  });
  if (error) fail('split', error);
  return { id: data as string, movedMentions: plan.moveMentions.length };
}

/** Remove an entity and everything that hangs off it (`entity` root of the deletion registry). */
export async function deleteEntity(client: UserClient, id: string): Promise<boolean> {
  const merges = await client
    .from('entity_merges')
    .delete()
    .or(`source_entity_id.eq.${id},target_entity_id.eq.${id}`);
  if (merges.error) fail('merge receipts delete', merges.error);
  const { data, error } = await client.from('entities').delete().eq('id', id).select('id');
  if (error) fail('entity delete', error);
  return (data?.length ?? 0) > 0;
}

/** The relation lexicon for the role picker (labels are display-only). */
export function roleOptions(): { role: string; label: string }[] {
  return RELATION_ROLES.map((r) => ({ role: r.role, label: r.label }));
}

export { roleForRelation };
export type { ExtractionPayload };
