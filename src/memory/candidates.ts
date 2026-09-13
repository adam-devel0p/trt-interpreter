import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import {
  entities,
  entityAliases,
  entityMentions,
  entityRoles,
  journeyMembers,
  journeys,
} from '@/db/schema';
import { normalizeAlias } from '@/domain/entities/normalize';
import type { CandidateEntity, MentionInput } from '@/domain/entities/resolve';
import { TRIGRAM_MIN } from '@/domain/entities/thresholds';

/**
 * Candidate generation for entity resolution (docs/ALGORITHMS.md §1, steps 1–4). Every
 * active entity of the user is a structural candidate (kind, recency and roles score it);
 * Postgres computes the pg_trgm similarity between the mention and the entity's aliases and
 * label (step 2), so the pure resolver never touches the database. Journeys (Phase 07) and
 * Journeys (Phase 07) fill `journeyIds` — the journeys whose live members mention the
 * entity (`auto` / `user` rows) — and `journeysExist`; embeddings (Phase 09) plug into the
 * same shape.
 */

export interface CandidateSet {
  all: CandidateEntity[];
  byId: Map<string, CandidateEntity>;
  /** The user has at least one growable journey, so the journey signal is available. */
  journeysExist: boolean;
}

/** Growable journeys (not dismissed, merged or closed) per entity, and per reading. */
export async function loadJourneyLinks(userId: string): Promise<{
  byEntity: Map<string, string[]>;
  byReading: Map<string, string[]>;
  exists: boolean;
}> {
  const db = platformDb();
  const rows = await db
    .select({
      journeyId: journeyMembers.journeyId,
      objectId: journeyMembers.objectId,
      entityId: entityMentions.entityId,
    })
    .from(journeyMembers)
    .innerJoin(journeys, eq(journeys.id, journeyMembers.journeyId))
    .leftJoin(
      entityMentions,
      and(
        eq(entityMentions.objectType, journeyMembers.objectType),
        eq(entityMentions.objectId, journeyMembers.objectId),
        inArray(entityMentions.resolution, ['auto', 'user']),
      ),
    )
    .where(
      and(
        eq(journeys.userId, userId),
        isNull(journeys.dismissedAt),
        isNull(journeys.mergedIntoId),
        ne(journeys.status, 'closed'),
        eq(journeyMembers.objectType, 'reading'),
        inArray(journeyMembers.state, ['auto', 'confirmed']),
      ),
    );
  const byEntity = new Map<string, string[]>();
  const byReading = new Map<string, string[]>();
  for (const r of rows) {
    const rl = byReading.get(r.objectId) ?? [];
    if (!rl.includes(r.journeyId)) rl.push(r.journeyId);
    byReading.set(r.objectId, rl);
    if (!r.entityId) continue;
    const el = byEntity.get(r.entityId) ?? [];
    if (!el.includes(r.journeyId)) el.push(r.journeyId);
    byEntity.set(r.entityId, el);
  }
  return { byEntity, byReading, exists: rows.length > 0 };
}

export async function loadCandidates(userId: string): Promise<CandidateSet> {
  const db = platformDb();
  const rows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.status, 'active')));
  if (rows.length === 0) return { all: [], byId: new Map(), journeysExist: false };
  const ids = rows.map((r) => r.id);
  const [aliasRows, roleRows, journeyLinks] = await Promise.all([
    db
      .select({ entityId: entityAliases.entityId, norm: entityAliases.aliasNormalized })
      .from(entityAliases)
      .where(inArray(entityAliases.entityId, ids)),
    db
      .select({
        entityId: entityRoles.entityId,
        role: entityRoles.role,
        validFrom: entityRoles.validFrom,
        validTo: entityRoles.validTo,
      })
      .from(entityRoles)
      .where(inArray(entityRoles.entityId, ids)),
    loadJourneyLinks(userId),
  ]);
  const aliases = new Map<string, string[]>();
  for (const a of aliasRows) aliases.set(a.entityId, [...(aliases.get(a.entityId) ?? []), a.norm]);
  const roles = new Map<string, CandidateEntity['roles'][number][]>();
  for (const r of roleRows)
    roles.set(r.entityId, [
      ...(roles.get(r.entityId) ?? []),
      { role: r.role, validFrom: r.validFrom, validTo: r.validTo },
    ]);
  const all = rows.map<CandidateEntity>((r) => ({
    id: r.id,
    kind: r.kind,
    canonicalLabel: r.canonicalLabel,
    aliases: aliases.get(r.id) ?? [],
    roles: roles.get(r.id) ?? [],
    lastSeenAt: r.lastSeenAt.toISOString(),
    userConfirmed: r.userConfirmed,
    journeyIds: journeyLinks.byEntity.get(r.id) ?? [],
  }));
  return { all, byId: new Map(all.map((c) => [c.id, c])), journeysExist: journeyLinks.exists };
}

/**
 * The candidate set with the mention's trigram similarity filled in (pg_trgm `similarity()`
 * over aliases and the canonical label; only values at or above the floor are carried).
 */
export async function candidatesForMention(
  userId: string,
  set: CandidateSet,
  m: MentionInput,
): Promise<CandidateEntity[]> {
  if (set.all.length === 0) return [];
  const norm = normalizeAlias(m.text);
  if (!norm) return set.all;
  const rows = await platformDb().execute<{ entity_id: string; sim: number }>(sql`
    select entity_id, max(sim)::float as sim from (
      select a.entity_id, similarity(a.alias_normalized, ${norm}) as sim
        from public.entity_aliases a where a.user_id = ${userId}
      union all
      select e.id as entity_id, similarity(lower(e.canonical_label), ${norm}) as sim
        from public.entities e where e.user_id = ${userId} and e.status = 'active'
    ) s group by entity_id having max(sim) >= ${TRIGRAM_MIN}
  `);
  const sims = new Map(rows.map((r) => [r.entity_id, Number(r.sim)]));
  return set.all.map((c) => (sims.has(c.id) ? { ...c, trigramSimilarity: sims.get(c.id) } : c));
}
