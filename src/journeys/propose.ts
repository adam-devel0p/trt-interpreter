import 'server-only';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getAiRunner } from '@/ai';
import type { AiRunner } from '@/ai/run';
import * as proposeTask from '@/ai/tasks/propose_journey';
import { platformDb } from '@/db/admin';
import { entityMentions, journeys, objectThemes, profiles, readings, themes } from '@/db/schema';
import { clip } from '@/domain/journeys/titles';
import { flagForUser } from '@/flags/server';
import { entityContextForObjects } from '@/memory/context.server';
import { logger } from '@/observability/logger';
import { liveMemberReadingIds } from './refresh';

/**
 * Naming a journey (`propose_journey`, spec §6.5). Reached only through the lazy job
 * registry — never from a request. Gates: consent, the `journey_autocreate` flag, and the
 * title not being the user's. Context is the minimum (§11): dates, questions, the entities
 * prompts may name (`entityContextForObjects`, auto + user only) and theme labels — no notes.
 * The write re-checks `title_source <> 'user'`, so a rename that landed while the model was
 * running wins. A `low` confidence keeps the placeholder title and stores the rationale.
 */

export type ProposeOutcome =
  | { status: 'skipped'; reason: 'missing' | 'merged' | 'pinned' | 'consent' | 'flag' | 'empty' }
  | { status: 'named'; title: string }
  | { status: 'kept'; reason: 'low_confidence' | 'renamed_meanwhile' }
  | { status: 'failed'; errorClass: string; retryable: boolean };

const RETRYABLE = new Set(['timeout', 'provider_error']);

export async function runProposeJourney(
  journeyId: string,
  opts: { runner?: AiRunner } = {},
): Promise<ProposeOutcome> {
  const db = platformDb();
  const [journey] = await db.select().from(journeys).where(eq(journeys.id, journeyId)).limit(1);
  if (!journey) return { status: 'skipped', reason: 'missing' };
  if (journey.mergedIntoId) return { status: 'skipped', reason: 'merged' };
  if (journey.titleSource === 'user') return { status: 'skipped', reason: 'pinned' };
  const [profile] = await db
    .select({ aiConsentAt: profiles.aiConsentAt })
    .from(profiles)
    .where(eq(profiles.id, journey.userId))
    .limit(1);
  if (!profile?.aiConsentAt) return { status: 'skipped', reason: 'consent' };
  if (!(await flagForUser('journey_autocreate', journey.userId)))
    return { status: 'skipped', reason: 'flag' };

  const ids = await liveMemberReadingIds(journeyId);
  if (ids.length === 0) return { status: 'skipped', reason: 'empty' };
  const [rows, themeRows, context] = await Promise.all([
    db
      .select({
        id: readings.id,
        occurredAt: readings.occurredAt,
        question: readings.question,
        isOpenReflection: readings.isOpenReflection,
      })
      .from(readings)
      .where(inArray(readings.id, ids)),
    db
      .select({ objectId: objectThemes.objectId, slug: themes.slug, label: themes.label })
      .from(objectThemes)
      .innerJoin(themes, eq(themes.id, objectThemes.themeId))
      .where(and(eq(objectThemes.objectType, 'reading'), inArray(objectThemes.objectId, ids))),
    entityContextForObjects(
      journey.userId,
      ids.map((id) => ({ type: 'reading', id })),
    ),
  ]);
  // Entities per reading, restricted to the sanctioned context set.
  const perReadingEntities = await entitiesPerReading(
    journey.userId,
    ids,
    new Set(context.map((c) => c.id)),
  );

  const entries = rows
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((r) => ({
      occurred_on: r.occurredAt.toISOString().slice(0, 10),
      question: r.isOpenReflection ? null : r.question,
      entities: (perReadingEntities.get(r.id) ?? [])
        .map((id) => context.find((c) => c.id === id)?.label)
        .filter((l): l is string => !!l),
      themes: themeRows.filter((t) => t.objectId === r.id).map((t) => t.label),
    }));
  const sharedEntities =
    entries
      .map((e) => new Set(e.entities))
      .reduce<string[] | null>(
        (acc, s) => (acc === null ? [...s] : acc.filter((x) => s.has(x))),
        null,
      ) ?? [];
  const sharedThemes =
    entries
      .map((e) => new Set(e.themes))
      .reduce<string[] | null>(
        (acc, s) => (acc === null ? [...s] : acc.filter((x) => s.has(x))),
        null,
      ) ?? [];
  const slugCounts = new Map<string, number>();
  for (const t of themeRows) slugCounts.set(t.slug, (slugCounts.get(t.slug) ?? 0) + 1);
  const themeSlugs = [...slugCounts].sort(([, a], [, b]) => b - a).map(([s]) => s);

  const runner = opts.runner ?? getAiRunner();
  const res = await runner.runObject(
    proposeTask.buildProposeJourneyRequest(
      {
        entries,
        shared_entities: sharedEntities,
        shared_themes: sharedThemes,
        current_title: journey.title,
      },
      { userId: journey.userId, journeyId, themeSlugs },
    ),
  );
  if (!res.ok) {
    logger.info('journeys.propose_failed', {
      userId: journey.userId,
      journeyId,
      errorClass: res.errorClass,
      status: res.status,
    });
    return { status: 'failed', errorClass: res.errorClass, retryable: RETRYABLE.has(res.status) };
  }
  const provenance = {
    rationale: res.value.rationale,
    modelId: res.meta.modelId,
    promptVersion: proposeTask.PROMPT_VERSION,
    schemaVersion: proposeTask.SCHEMA_VERSION,
    namedAt: new Date(),
  };
  if (res.value.confidence === 'low') {
    await db
      .update(journeys)
      .set(provenance)
      .where(and(eq(journeys.id, journeyId), ne(journeys.titleSource, 'user')));
    return { status: 'kept', reason: 'low_confidence' };
  }
  const updated = await db
    .update(journeys)
    .set({ ...provenance, title: clip(res.value.title), titleSource: 'model' })
    .where(and(eq(journeys.id, journeyId), ne(journeys.titleSource, 'user')))
    .returning({ id: journeys.id });
  if (updated.length === 0) return { status: 'kept', reason: 'renamed_meanwhile' };
  logger.info('journeys.named', { userId: journey.userId, journeyId, modelId: res.meta.modelId });
  return { status: 'named', title: clip(res.value.title) };
}

/** Which of the context entities each reading mentions (auto + user rows only). */
async function entitiesPerReading(
  userId: string,
  readingIds: string[],
  allowed: Set<string>,
): Promise<Map<string, string[]>> {
  const rows = await platformDb()
    .select({ objectId: entityMentions.objectId, entityId: entityMentions.entityId })
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.userId, userId),
        eq(entityMentions.objectType, 'reading'),
        inArray(entityMentions.objectId, readingIds),
        inArray(entityMentions.resolution, ['auto', 'user']),
      ),
    );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!allowed.has(r.entityId)) continue;
    const list = out.get(r.objectId) ?? [];
    if (!list.includes(r.entityId)) list.push(r.entityId);
    out.set(r.objectId, list);
  }
  return out;
}
