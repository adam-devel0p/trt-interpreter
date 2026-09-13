import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { entities, entityAliases, entityRoles } from '@/db/schema';
import { normalizeAlias } from '@/domain/entities/normalize';
import type { CandidateEntity, MentionInput } from '@/domain/entities/resolve';
import { TRIGRAM_MIN } from '@/domain/entities/thresholds';

/**
 * Candidate generation for entity resolution (docs/ALGORITHMS.md §1, steps 1–4). Every
 * active entity of the user is a structural candidate (kind, recency and roles score it);
 * Postgres computes the pg_trgm similarity between the mention and the entity's aliases and
 * label (step 2), so the pure resolver never touches the database. Journeys (Phase 07) and
 * embeddings (Phase 09) plug into the same shape.
 */

export interface CandidateSet {
  all: CandidateEntity[];
  byId: Map<string, CandidateEntity>;
}

export async function loadCandidates(userId: string): Promise<CandidateSet> {
  const db = platformDb();
  const rows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.status, 'active')));
  if (rows.length === 0) return { all: [], byId: new Map() };
  const ids = rows.map((r) => r.id);
  const [aliasRows, roleRows] = await Promise.all([
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
  }));
  return { all, byId: new Map(all.map((c) => [c.id, c])) };
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
