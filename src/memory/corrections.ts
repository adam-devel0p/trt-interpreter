import 'server-only';
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { createEntity, deleteOverride, upsertOverride } from '@/db/queries/memory';
import { overrideKey } from '@/domain/extraction/overrides';
import { ENTITY_KINDS, THEME_CATEGORIES } from '@/domain/extraction/schema';
import { LIFE_AREAS } from '@/domain/readings/types';
import { themeSlugFor } from '@/domain/extraction/overrides';
import { logger } from '@/observability/logger';
import { materializeReading, type MaterializeResult } from './materialize';

/**
 * User corrections to extracted metadata (FR-26). Each correction is one `metadata_overrides`
 * row written as the user (RLS), then the reading is re-materialised so every derived table
 * reflects the effective state — one code path for "what the user sees", whichever way the
 * data arrived. Overrides are authoritative: a later re-extraction layers them back on.
 * Model-free: nothing here calls `src/ai/`.
 */

const lifeAreaKeys = LIFE_AREAS.map((a) => a.key) as [string, ...string[]];

export const correctionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_life_area'), value: z.enum(lifeAreaKeys).nullable() }).strict(),
  z.object({ type: z.literal('dismiss_theme'), slug: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('confirm_theme'), slug: z.string().min(1).max(64) }).strict(),
  z
    .object({
      type: z.literal('add_theme'),
      label: z.string().trim().min(1).max(120),
      category: z.enum(THEME_CATEGORIES).optional(),
    })
    .strict(),
  z.object({ type: z.literal('dismiss_entity'), mention: z.string().min(1).max(120) }).strict(),
  z
    .object({
      type: z.literal('link_entity'),
      mention: z.string().min(1).max(120),
      entityId: z.string().uuid(),
    })
    .strict(),
  /** "Someone else": a new, user-confirmed entity from the mention, then linked. */
  z
    .object({
      type: z.literal('new_entity'),
      mention: z.string().min(1).max(120),
      label: z.string().trim().min(1).max(120).optional(),
      kind: z.enum(ENTITY_KINDS).default('person'),
    })
    .strict(),
  z.object({ type: z.literal('dismiss_possibility'), key: z.string().min(1).max(16) }).strict(),
  z
    .object({
      type: z.literal('edit_possibility'),
      key: z.string().min(1).max(16),
      text: z.string().trim().min(1).max(400),
    })
    .strict(),
  z.object({ type: z.literal('dismiss_timeframe') }).strict(),
  z.object({ type: z.literal('edit_timeframe'), text: z.string().trim().min(1).max(120) }).strict(),
  /** Undo a correction: remove the override and let the extraction speak again. */
  z.object({ type: z.literal('clear'), fieldPath: z.string().min(1).max(200) }).strict(),
]);
export type Correction = z.infer<typeof correctionSchema>;

export async function applyCorrection(
  client: UserClient,
  userId: string,
  readingId: string,
  raw: unknown,
): Promise<{ correction: Correction['type']; materialized: MaterializeResult }> {
  const c = correctionSchema.parse(raw);
  switch (c.type) {
    case 'set_life_area':
      await upsertOverride(client, userId, readingId, overrideKey.lifeArea(), {
        kind: 'life_area',
        value: c.value,
      });
      break;
    case 'dismiss_theme':
      await upsertOverride(client, userId, readingId, overrideKey.theme(c.slug), {
        kind: 'theme',
        state: 'dismissed',
      });
      break;
    case 'confirm_theme':
      await upsertOverride(client, userId, readingId, overrideKey.theme(c.slug), {
        kind: 'theme',
        state: 'confirmed',
      });
      break;
    case 'add_theme': {
      const slug = themeSlugFor(c.label);
      await upsertOverride(client, userId, readingId, overrideKey.theme(slug), {
        kind: 'theme',
        state: 'added',
        label: c.label,
        ...(c.category ? { category: c.category } : {}),
      });
      break;
    }
    case 'dismiss_entity':
      await upsertOverride(client, userId, readingId, overrideKey.entity(c.mention), {
        kind: 'entity',
        state: 'dismissed',
      });
      break;
    case 'link_entity':
      await upsertOverride(client, userId, readingId, overrideKey.entity(c.mention), {
        kind: 'entity',
        state: 'linked',
        entityId: c.entityId,
      });
      break;
    case 'new_entity': {
      const created = await createEntity(client, userId, {
        label: c.label ?? c.mention,
        kind: c.kind,
        alias: c.mention,
      });
      await upsertOverride(client, userId, readingId, overrideKey.entity(c.mention), {
        kind: 'entity',
        state: 'linked',
        entityId: created.id,
      });
      break;
    }
    case 'dismiss_possibility':
      await upsertOverride(client, userId, readingId, `possibilities/${c.key}`, {
        kind: 'possibility',
        state: 'dismissed',
      });
      break;
    case 'edit_possibility':
      await upsertOverride(client, userId, readingId, `possibilities/${c.key}`, {
        kind: 'possibility',
        state: 'edited',
        text: c.text,
      });
      break;
    case 'dismiss_timeframe':
      await upsertOverride(client, userId, readingId, overrideKey.timeframe(), {
        kind: 'timeframe',
        state: 'dismissed',
      });
      break;
    case 'edit_timeframe':
      await upsertOverride(client, userId, readingId, overrideKey.timeframe(), {
        kind: 'timeframe',
        state: 'edited',
        text: c.text,
      });
      break;
    case 'clear':
      await deleteOverride(client, readingId, c.fieldPath);
      break;
  }
  const materialized = await materializeReading(readingId);
  logger.info('memory.correction.applied', {
    userId,
    objectType: 'reading',
    objectId: readingId,
    status: c.type,
  });
  return { correction: c.type, materialized };
}
