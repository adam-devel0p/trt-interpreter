import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import {
  entities,
  entityMentions,
  entityMerges,
  extractions,
  metadataOverrides,
  objectThemes,
  predictions,
  profiles,
  readings,
  themes,
} from '../src/db/schema';
import { planMerge } from '../src/domain/entities/merge';
import { overrideKey } from '../src/domain/extraction/overrides';
import { materializeReading } from '../src/memory/materialize';
import { runExtraction } from '../src/memory/extract';
import type { SeedContext } from './seed-demo';

/**
 * Phase 06 — structured memory for the consenting demo user's journal: every live reading is
 * extracted in date order through the real job path (the mock provider, the real resolver),
 * so the entities that emerge — a partner named three ways, an employer, a city, a friend, a
 * parent — are what the product would have produced. A few corrections a person would make
 * are then applied the way the UI applies them (overrides + the merge function as the user),
 * so 07/08/09 inherit a merge receipt, a relink and a partner → ex-partner role change.
 * The readings seeder regenerates readings, so this wipes and rebuilds derived rows too.
 */
export async function seedMemory(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedMemory needs the users seeder first');

  // Derived rows keyed by reading id are orphaned by the readings reset; start clean.
  await db.delete(entities).where(inArray(entities.userId, userIds));
  await db.delete(entityMerges).where(inArray(entityMerges.userId, userIds));
  await db.delete(extractions).where(inArray(extractions.userId, userIds));
  await db.delete(metadataOverrides).where(inArray(metadataOverrides.userId, userIds));
  await db.delete(objectThemes).where(inArray(objectThemes.userId, userIds));
  await db.delete(predictions).where(inArray(predictions.userId, userIds));
  await db.delete(themes).where(inArray(themes.userId, userIds));
  await db.delete(entityMentions).where(inArray(entityMentions.userId, userIds));

  const consenting = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.id, userIds), sql`${profiles.aiConsentAt} is not null`));
  let extracted = 0;
  let created = 0;
  for (const { id: userId } of consenting) {
    // The flag is off by default; the demo user is on the rollout.
    await platformSql()`
      insert into public.user_flags (user_id, flag, enabled, set_by)
      values (${userId}, 'ai_extraction', true, 'rollout')
      on conflict (user_id, flag) do update set enabled = true`;
    const rows = await db
      .select({ id: readings.id })
      .from(readings)
      .where(and(eq(readings.userId, userId), isNull(readings.deletedAt)))
      .orderBy(asc(readings.occurredAt));
    for (const r of rows) {
      const out = await runExtraction(r.id, { force: true });
      if (out.status === 'complete') {
        extracted += 1;
        created += out.materialized.entitiesCreated;
      }
    }
    await applyDemoCorrections(userId);
  }
  console.log(`  ${extracted} readings extracted, ${created} entities found, corrections applied`);
}

/** What a person would fix after a month: the same partner under two entries, and an ex. */
async function applyDemoCorrections(userId: string): Promise<void> {
  const db = platformDb();
  const byLabel = async (label: string) =>
    (
      await db
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.status, 'active'),
            sql`lower(${entities.canonicalLabel}) = ${label.toLowerCase()}`,
          ),
        )
        .limit(1)
    )[0]?.id;

  const maya = await byLabel('Maya');
  const m = await byLabel('M.');
  if (maya && m) await mergeAsUser(userId, m, maya);

  // "my ex" was a tentative match for Maya: the user confirms it, which records the role change.
  if (maya) {
    const [mention] = await db
      .select({ objectId: entityMentions.objectId, text: entityMentions.mentionText })
      .from(entityMentions)
      .where(and(eq(entityMentions.userId, userId), eq(entityMentions.mentionNormalized, 'ex')))
      .limit(1);
    if (mention) {
      await db
        .insert(metadataOverrides)
        .values({
          userId,
          objectType: 'reading',
          objectId: mention.objectId,
          fieldPath: overrideKey.entity(mention.text),
          value: { kind: 'entity', state: 'linked', entityId: maya },
        })
        .onConflictDoNothing();
      await materializeReading(mention.objectId);
    }
  }
}

/** Run the merge function as the user (auth.uid() from a transaction-local JWT claim). */
async function mergeAsUser(userId: string, sourceId: string, targetId: string): Promise<void> {
  const db = platformDb();
  const side = async (id: string) => ({
    id,
    aliases: await db
      .select({ id: sql<string>`id`, aliasNormalized: sql<string>`alias_normalized` })
      .from(sql`public.entity_aliases`)
      .where(sql`entity_id = ${id}`),
    mentions: await db
      .select({
        id: sql<string>`id`,
        mentionNormalized: sql<string>`mention_normalized`,
        objectType: sql<string>`object_type`,
        objectId: sql<string>`object_id`,
      })
      .from(sql`public.entity_mentions`)
      .where(sql`entity_id = ${id}`),
    roles: await db
      .select({
        id: sql<string>`id`,
        role: sql<string>`role`,
        validFrom: sql<string>`valid_from::text`,
        validTo: sql<string | null>`valid_to::text`,
      })
      .from(sql`public.entity_roles`)
      .where(sql`entity_id = ${id}`),
  });
  const plan = planMerge(await side(sourceId), await side(targetId));
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  await platformSql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`select public.apply_entity_merge(${sourceId}::uuid, ${targetId}::uuid, ${JSON.stringify(
      {
        move_aliases: plan.moveAliases,
        drop_aliases: plan.dropAliases,
        move_mentions: plan.moveMentions,
        drop_mentions: plan.dropMentions,
        move_roles: plan.moveRoles,
        drop_roles: plan.dropRoles,
      },
    )}::jsonb)`;
  });
}
