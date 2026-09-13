import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { entities, entityMentions } from '@/db/schema';
import { buildEntityContext, CONTEXT_RESOLUTIONS, type EntityContextItem } from './context';

/** The entities a prompt may name for a set of objects — `auto` and `user` resolutions only. */
export async function entityContextForObjects(
  userId: string,
  objects: { type: string; id: string }[],
): Promise<EntityContextItem[]> {
  if (objects.length === 0) return [];
  const db = platformDb();
  const mentions = await db
    .select({
      entityId: entityMentions.entityId,
      resolution: entityMentions.resolution,
      mentionText: entityMentions.mentionText,
    })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.userId, userId),
        inArray(entityMentions.resolution, [...CONTEXT_RESOLUTIONS]),
        inArray(
          entityMentions.objectId,
          objects.map((o) => o.id),
        ),
      ),
    );
  if (mentions.length === 0) return [];
  const rows = await db
    .select({
      id: entities.id,
      canonicalLabel: entities.canonicalLabel,
      kind: entities.kind,
      status: entities.status,
    })
    .from(entities)
    .where(inArray(entities.id, [...new Set(mentions.map((m) => m.entityId))]));
  return buildEntityContext(mentions, rows);
}
