import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import {
  entities,
  entityAliases,
  entityMentions,
  entityRoles,
  extractions,
  lifeEvents,
  metadataOverrides,
  objectThemes,
  predictions,
  readings,
  themes,
} from '@/db/schema';
import { planApply } from '@/domain/entities/apply';
import { mentionRole, resolveMention, type MentionInput } from '@/domain/entities/resolve';
import { planRoleChange, type RolePlan } from '@/domain/entities/roles';
import { MAX_ASKS_PER_OBJECT } from '@/domain/entities/thresholds';
import {
  applyOverrides,
  parseOverride,
  type EffectiveMetadata,
  type Override,
} from '@/domain/extraction/overrides';
import { eventExtractionPayloadSchema, extractionPayloadSchema } from '@/domain/extraction/schema';
import { modelBorn } from '@/domain/facts/writeGate';
import { logger } from '@/observability/logger';
import { materializeJourneysSafely } from '@/journeys/materialize';
import { enqueueCorrelationSafely } from '@/correlation/run';
import { enqueueEmbedSafely } from '@/retrieval/enqueue';
import {
  candidatesForMention,
  loadCandidates,
  loadJourneyLinks,
  type CandidateSet,
} from './candidates';

/**
 * Materialise a reading's structured memory from its newest extraction **with the user's
 * overrides layered on top** (FR-26): theme links, entity mentions (resolved through
 * `domain/entities/resolve.ts`), entities and aliases, temporal roles, predictions. Idempotent
 * and model-free — it is what runs after an extraction completes, after a reprocess, and
 * after every correction, so the tables always reflect the effective state. Service role,
 * by design: an extraction job has no session; every write is scoped by the reading's owner.
 *
 * Rules that make this honest:
 *   - model-born rows go through `modelBorn()` — never confirmed, never `resolution = 'user'`;
 *   - a mention the user pinned (`resolution = 'user'`) is never deleted or re-resolved here;
 *   - a tentative link changes nothing on the entity (no alias, no role, no rename);
 *   - a mention already resolved by *this* extraction keeps its decision — only new
 *     extractions re-resolve, so a correction elsewhere cannot silently flip a link;
 *   - at most one open disambiguation per reading (§4.1).
 */

export type MemoryObjectType = 'reading' | 'life_event';

export interface MaterializeResult {
  readingId: string;
  objectType: MemoryObjectType;
  objectId: string;
  skipped?: 'missing' | 'deleted' | 'no_extraction';
  themes: number;
  mentions: number;
  entitiesCreated: number;
  predictions: number;
  asked: boolean;
}

export async function loadOverrides(objectType: string, objectId: string): Promise<Override[]> {
  const rows = await platformDb()
    .select({ fieldPath: metadataOverrides.fieldPath, value: metadataOverrides.value })
    .from(metadataOverrides)
    .where(
      and(eq(metadataOverrides.objectType, objectType), eq(metadataOverrides.objectId, objectId)),
    );
  return rows.map((r) => parseOverride(r.fieldPath, r.value)).filter((o): o is Override => !!o);
}

export async function currentExtraction(objectType: string, objectId: string) {
  const [row] = await platformDb()
    .select()
    .from(extractions)
    .where(
      and(
        eq(extractions.objectType, objectType),
        eq(extractions.objectId, objectId),
        eq(extractions.status, 'complete'),
        isNull(extractions.supersededBy),
      ),
    )
    .orderBy(desc(extractions.createdAt))
    .limit(1);
  return row ?? null;
}

export interface MaterializeOptions {
  /**
   * Materialise from this (still pending) extraction instead of the current one, so the row
   * can be marked complete only after its rows exist — a reader never sees a complete
   * extraction without its themes and mentions.
   */
  extraction?: { id: string; payload: unknown };
}

export async function materializeReading(
  readingId: string,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  return materializeObject('reading', readingId, opts);
}

/** Phase 08: a life event's extraction lands in the same tables, keyed by `life_event`. */
export async function materializeEvent(
  eventId: string,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  return materializeObject('life_event', eventId, opts);
}

async function loadObject(
  objectType: MemoryObjectType,
  objectId: string,
): Promise<{ userId: string; occurredAt: Date; deletedAt: Date | null } | null> {
  const db = platformDb();
  if (objectType === 'reading') {
    const [r] = await db
      .select({
        userId: readings.userId,
        occurredAt: readings.occurredAt,
        deletedAt: readings.deletedAt,
      })
      .from(readings)
      .where(eq(readings.id, objectId))
      .limit(1);
    return r ?? null;
  }
  const [e] = await db
    .select({
      userId: lifeEvents.userId,
      occurredOn: lifeEvents.occurredOn,
      deletedAt: lifeEvents.deletedAt,
    })
    .from(lifeEvents)
    .where(eq(lifeEvents.id, objectId))
    .limit(1);
  // A date, not an instant: midday UTC keeps it on the same calendar day everywhere.
  return e ? { ...e, occurredAt: new Date(`${e.occurredOn}T12:00:00Z`) } : null;
}

export async function materializeObject(
  objectType: MemoryObjectType,
  objectId: string,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const empty: MaterializeResult = {
    readingId: objectId,
    objectType,
    objectId,
    themes: 0,
    mentions: 0,
    entitiesCreated: 0,
    predictions: 0,
    asked: false,
  };
  const object = await loadObject(objectType, objectId);
  if (!object) return { ...empty, skipped: 'missing' };
  if (object.deletedAt) return { ...empty, skipped: 'deleted' };
  const extraction = opts.extraction ?? (await currentExtraction(objectType, objectId));
  if (!extraction) return { ...empty, skipped: 'no_extraction' };
  const eventPayload =
    objectType === 'life_event' ? eventExtractionPayloadSchema.parse(extraction.payload) : null;
  const payload = eventPayload ?? extractionPayloadSchema.parse(extraction.payload);
  const overrides = await loadOverrides(objectType, objectId);
  const eff = applyOverrides(payload, overrides);
  const userId = object.userId;
  const at = object.occurredAt.toISOString();

  const themeCount = await materializeThemes(userId, objectType, objectId, extraction.id, eff);
  const ent = await materializeEntities(userId, objectType, objectId, extraction.id, at, eff);
  const predictionCount =
    objectType === 'reading'
      ? await materializePredictions(userId, objectId, extraction.id, eff)
      : 0;
  if (eventPayload) {
    // Promoted columns (queried and filtered): the payload stays the source of truth.
    await platformDb()
      .update(lifeEvents)
      .set({
        eventType: eventPayload.event_type,
        importance: eventPayload.importance,
        emotionalTone: eff.emotionalTone,
        lifeArea: eff.lifeArea.value,
      })
      .where(eq(lifeEvents.id, objectId));
  }
  // Phase 07: assignment and discovery run on the resolved mentions and themes just written.
  // Derived from derived — a failure here is logged and never fails the extraction.
  await materializeJourneysSafely(objectType, objectId);
  // Phase 08: correlation is a queued, model-free job over the rows just written (deduped).
  await enqueueCorrelationSafely(objectType, objectId, userId);
  // Phase 09: the retrieval document is rebuilt from the rows just written (deduped).
  await enqueueEmbedSafely(objectType, objectId, userId);

  logger.info('memory.materialized', {
    userId,
    objectType,
    objectId,
    count: ent.mentions,
  });
  return {
    readingId: objectId,
    objectType,
    objectId,
    themes: themeCount,
    mentions: ent.mentions,
    entitiesCreated: ent.created,
    predictions: predictionCount,
    asked: ent.asked,
  };
}

// ── Themes ─────────────────────────────────────────────────────────────────────────────────

async function ensureTheme(
  userId: string,
  t: EffectiveMetadata['themes'][number],
): Promise<string> {
  const db = platformDb();
  const rows = await db
    .select({ id: themes.id, userId: themes.userId })
    .from(themes)
    .where(
      and(eq(themes.slug, t.slug), sql`(${themes.userId} is null or ${themes.userId} = ${userId})`),
    )
    .orderBy(sql`${themes.userId} nulls first`)
    .limit(1);
  if (rows[0]) return rows[0].id;
  const [created] = await db
    .insert(themes)
    .values({ userId, slug: t.slug, label: t.label, category: t.category })
    .onConflictDoNothing()
    .returning({ id: themes.id });
  if (created) return created.id;
  const [again] = await db
    .select({ id: themes.id })
    .from(themes)
    .where(and(eq(themes.slug, t.slug), eq(themes.userId, userId)))
    .limit(1);
  if (!again) throw new Error('theme upsert failed');
  return again.id;
}

async function materializeThemes(
  userId: string,
  objectType: MemoryObjectType,
  objectId: string,
  extractionId: string,
  eff: EffectiveMetadata,
): Promise<number> {
  const db = platformDb();
  const desired = new Map<string, EffectiveMetadata['themes'][number]>();
  for (const t of eff.themes) desired.set(await ensureTheme(userId, t), t);
  const existing = await db
    .select({ id: objectThemes.id, themeId: objectThemes.themeId })
    .from(objectThemes)
    .where(and(eq(objectThemes.objectType, objectType), eq(objectThemes.objectId, objectId)));
  const stale = existing.filter((e) => !desired.has(e.themeId)).map((e) => e.id);
  if (stale.length) await db.delete(objectThemes).where(inArray(objectThemes.id, stale));
  for (const [themeId, t] of desired) {
    const row = {
      user_id: userId,
      object_type: objectType,
      object_id: objectId,
      theme_id: themeId,
      weight: t.weight.toFixed(3),
      source: t.source,
      user_confirmed: t.confirmed,
      extraction_id: t.source === 'model' ? extractionId : null,
    };
    if (t.source === 'model' && !t.confirmed) modelBorn(row);
    await db
      .insert(objectThemes)
      .values({
        userId,
        objectType,
        objectId,
        themeId,
        weight: row.weight,
        source: t.source,
        userConfirmed: t.confirmed,
        extractionId: row.extraction_id,
      })
      .onConflictDoUpdate({
        target: [objectThemes.objectType, objectThemes.objectId, objectThemes.themeId],
        set: {
          weight: row.weight,
          source: t.source,
          userConfirmed: t.confirmed,
          extractionId: row.extraction_id,
        },
      });
  }
  return desired.size;
}

// ── Entities ───────────────────────────────────────────────────────────────────────────────

async function applyRolePlan(
  userId: string,
  entityId: string,
  plan: RolePlan,
  source: 'model' | 'user',
  evidence: { type: string; id: string },
): Promise<void> {
  const db = platformDb();
  for (const c of plan.close)
    await db.update(entityRoles).set({ validTo: c.validTo }).where(eq(entityRoles.id, c.id));
  if (plan.add) {
    const row = { source, user_confirmed: false };
    if (source === 'model') modelBorn(row);
    await db.insert(entityRoles).values({
      userId,
      entityId,
      role: plan.add.role,
      validFrom: plan.add.validFrom,
      validTo: null,
      source,
      evidenceObjectType: evidence.type,
      evidenceObjectId: evidence.id,
    });
  }
}

async function roleRowsOf(entityId: string) {
  return platformDb()
    .select({
      id: entityRoles.id,
      role: entityRoles.role,
      validFrom: entityRoles.validFrom,
      validTo: entityRoles.validTo,
    })
    .from(entityRoles)
    .where(eq(entityRoles.entityId, entityId));
}

async function materializeEntities(
  userId: string,
  objectType: MemoryObjectType,
  objectId: string,
  extractionId: string,
  at: string,
  eff: EffectiveMetadata,
): Promise<{ mentions: number; created: number; asked: boolean }> {
  const db = platformDb();
  const readingId = objectId;
  const evidence = { type: objectType, id: objectId };
  const existing = await db
    .select()
    .from(entityMentions)
    .where(and(eq(entityMentions.objectType, objectType), eq(entityMentions.objectId, objectId)));
  const byNorm = new Map(existing.map((m) => [m.mentionNormalized, m]));
  const wanted = new Set(eff.entities.map((e) => e.normalized));

  // 1. Drop model-resolved mentions the effective set no longer contains (dismissed, or gone
  //    from a newer extraction). User-pinned rows stay whatever the model says this time.
  const stale = existing
    .filter((m) => m.resolution !== 'user' && !wanted.has(m.mentionNormalized))
    .map((m) => m.id);
  if (stale.length) await db.delete(entityMentions).where(inArray(entityMentions.id, stale));

  let candidates: CandidateSet = await loadCandidates(userId);
  // Journey signal (ALGORITHMS §1): the journeys this object already sits in.
  const journeyIds = (await loadJourneyLinks(userId)).byObject.get(objectId) ?? [];
  let created = 0;
  let asks = existing.filter(
    (m) => m.resolution !== 'user' && wanted.has(m.mentionNormalized) && m.askCandidates?.length,
  ).length;
  let count = existing.filter((m) => m.resolution === 'user').length;

  for (const e of eff.entities) {
    const m: MentionInput = { text: e.mention, kind: e.kind, relation: e.relation, occurredAt: at };
    const prior = byNorm.get(e.normalized);

    // 2. A user relink: authoritative. Alias, role and last-seen follow the user's word.
    if (e.linkedEntityId) {
      const target = candidates.byId.get(e.linkedEntityId);
      if (!target) {
        logger.warn('memory.relink_target_missing', { objectId: readingId, userId });
        continue;
      }
      await db
        .insert(entityMentions)
        .values({
          userId,
          entityId: target.id,
          objectType,
          objectId,
          mentionText: e.mention,
          mentionNormalized: e.normalized,
          confidence: '1.000',
          resolution: 'user',
          signals: null,
          reasons: ['You linked this yourself'],
          askCandidates: null,
          extractionId,
        })
        .onConflictDoUpdate({
          target: [
            entityMentions.objectType,
            entityMentions.objectId,
            entityMentions.mentionNormalized,
          ],
          set: {
            entityId: target.id,
            confidence: '1.000',
            resolution: 'user',
            signals: null,
            reasons: ['You linked this yourself'],
            askCandidates: null,
            extractionId,
          },
        });
      if (!target.aliases.includes(e.normalized)) {
        await db
          .insert(entityAliases)
          .values({
            userId,
            entityId: target.id,
            alias: e.mention,
            aliasNormalized: e.normalized,
            context: mentionRole(m)?.role ?? null,
            confidence: '1.000',
            source: 'user',
          })
          .onConflictDoNothing();
      }
      const role = mentionRole(m);
      if (role) {
        const plan = planRoleChange(await roleRowsOf(target.id), role.role, at);
        if (plan.add || plan.close.length)
          await applyRolePlan(userId, target.id, plan, 'user', evidence);
      }
      await db
        .update(entities)
        .set({
          userConfirmed: true,
          lastSeenAt: sql`greatest(${entities.lastSeenAt}, ${at}::timestamptz)`,
          firstSeenAt: sql`least(${entities.firstSeenAt}, ${at}::timestamptz)`,
        })
        .where(eq(entities.id, target.id));
      candidates = await loadCandidates(userId);
      count += prior?.resolution === 'user' ? 0 : 1;
      continue;
    }

    // 3. Already decided by this very extraction: keep the decision.
    if (prior && prior.extractionId === extractionId && prior.resolution !== 'rejected') {
      count += prior.resolution === 'user' ? 0 : 1;
      continue;
    }
    if (prior?.resolution === 'user') continue;

    // 4. Resolve.
    const scored = await candidatesForMention(userId, candidates, m);
    let decision = resolveMention(m, scored, {
      journeysExist: candidates.journeysExist,
      journeyIds,
    });
    if (decision.kind === 'ask' && asks >= MAX_ASKS_PER_OBJECT) {
      decision = {
        kind: 'tentative',
        entityId: decision.entityId,
        score: decision.score,
        signals: decision.signals,
        reasons: decision.reasons,
        namesEntity: false,
        role: decision.role,
      };
    }
    if (decision.kind === 'drop') continue;
    const target =
      decision.kind === 'new' ? null : (candidates.byId.get(decision.entityId) ?? null);
    const mut = planApply(
      decision,
      m,
      target ? { aliases: target.aliases, roles: await roleRowsOf(target.id) } : null,
    );
    if (!mut.mention) continue;

    let entityId = target?.id ?? null;
    if (mut.createEntity) {
      const c = mut.createEntity;
      const [row] = await db
        .insert(entities)
        .values(
          modelBorn({
            userId,
            kind: c.kind,
            canonicalLabel: c.canonicalLabel,
            status: 'active',
            firstSeenAt: new Date(at),
            lastSeenAt: new Date(at),
            userConfirmed: false,
          }),
        )
        .returning({ id: entities.id });
      entityId = row!.id;
      await db.insert(entityAliases).values(
        modelBorn({
          userId,
          entityId,
          alias: c.alias.alias,
          aliasNormalized: c.alias.normalized,
          context: c.alias.context,
          confidence: '1.000',
          source: 'model' as const,
        }),
      );
      if (c.role)
        await applyRolePlan(userId, entityId, { close: [], add: c.role }, 'model', evidence);
      created += 1;
    } else if (entityId) {
      if (mut.addAlias)
        await db
          .insert(entityAliases)
          .values(
            modelBorn({
              userId,
              entityId,
              alias: mut.addAlias.alias,
              aliasNormalized: mut.addAlias.normalized,
              context: mut.addAlias.context,
              confidence: mut.mention.confidence.toFixed(3),
              source: 'model' as const,
            }),
          )
          .onConflictDoNothing();
      if (mut.rename)
        await db
          .update(entities)
          .set({ canonicalLabel: mut.rename })
          .where(and(eq(entities.id, entityId), eq(entities.userConfirmed, false)));
      if (mut.roles) await applyRolePlan(userId, entityId, mut.roles, 'model', evidence);
      if (mut.touchLastSeen)
        await db
          .update(entities)
          .set({
            lastSeenAt: sql`greatest(${entities.lastSeenAt}, ${mut.touchLastSeen}::timestamptz)`,
            firstSeenAt: sql`least(${entities.firstSeenAt}, ${mut.touchLastSeen}::timestamptz)`,
          })
          .where(eq(entities.id, entityId));
    }
    if (!entityId) continue;

    const mentionRow = modelBorn({
      userId,
      entityId,
      objectType,
      objectId,
      mentionText: mut.mention.text,
      mentionNormalized: mut.mention.normalized,
      confidence: mut.mention.confidence.toFixed(3),
      resolution: mut.mention.resolution,
      signals: mut.mention.signals,
      reasons: mut.mention.reasons,
      askCandidates: mut.mention.askCandidates,
      extractionId,
    });
    await db
      .insert(entityMentions)
      .values(mentionRow)
      .onConflictDoUpdate({
        target: [
          entityMentions.objectType,
          entityMentions.objectId,
          entityMentions.mentionNormalized,
        ],
        set: {
          entityId: mentionRow.entityId,
          mentionText: mentionRow.mentionText,
          confidence: mentionRow.confidence,
          resolution: mentionRow.resolution,
          signals: mentionRow.signals,
          reasons: mentionRow.reasons,
          askCandidates: mentionRow.askCandidates,
          extractionId,
        },
      });
    if (mut.mention.askCandidates) asks += 1;
    count += 1;
    // Later mentions in the same reading see what this one created or renamed.
    if (mut.createEntity || mut.addAlias || mut.rename || mut.roles)
      candidates = await loadCandidates(userId);
  }
  return { mentions: count, created, asked: asks > 0 };
}

// ── Predictions ────────────────────────────────────────────────────────────────────────────

async function materializePredictions(
  userId: string,
  readingId: string,
  extractionId: string,
  eff: EffectiveMetadata,
): Promise<number> {
  const db = platformDb();
  const dismissedKeys = new Set<string>();
  const wanted = new Set(eff.possibilities.map((p) => p.key));
  for (const p of eff.possibilities) {
    const row = modelBorn({
      userId,
      readingId,
      text: p.text,
      textHash: p.key,
      category: p.category,
      timeframeText: p.timeframe,
      kind: p.kind,
      factStatus: 'POSSIBILITY' as const,
      extractedFrom: extractionId,
      userEdited: p.source === 'user',
    });
    await db
      .insert(predictions)
      .values(row)
      .onConflictDoUpdate({
        target: [predictions.readingId, predictions.textHash],
        set: {
          text: row.text,
          category: row.category,
          timeframeText: row.timeframeText,
          kind: row.kind,
          extractedFrom: extractionId,
          userEdited: row.userEdited,
          dismissedAt: null,
        },
      });
  }
  // A dismissed possibility keeps its row (stable id for Phase 08) with dismissed_at set;
  // rows a newer extraction simply no longer produces are left as they are.
  const existing = await db
    .select({
      id: predictions.id,
      textHash: predictions.textHash,
      dismissedAt: predictions.dismissedAt,
    })
    .from(predictions)
    .where(eq(predictions.readingId, readingId));
  for (const p of existing) {
    if (wanted.has(p.textHash) || p.dismissedAt) continue;
    if (eff.possibilities.some((x) => x.key === p.textHash)) continue;
    dismissedKeys.add(p.textHash);
  }
  const overridesDismissed = (await loadOverrides('reading', readingId)).filter(
    (o) => o.value.kind === 'possibility' && o.value.state === 'dismissed',
  );
  for (const o of overridesDismissed) {
    const key = o.fieldPath.slice('possibilities/'.length);
    if (!dismissedKeys.has(key)) continue;
    await db
      .update(predictions)
      .set({ dismissedAt: new Date() })
      .where(and(eq(predictions.readingId, readingId), eq(predictions.textHash, key)));
  }
  return eff.possibilities.length;
}
