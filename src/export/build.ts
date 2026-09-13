import 'server-only';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { platformDb } from '@/db/admin';
import {
  cards,
  decks,
  deletionReceipts,
  interpretations,
  profiles,
  questionEmbeddings,
  readingCards,
  readingNoteRevisions,
  readings,
  safetyFlags,
  spreads,
} from '@/db/schema';
import {
  EXPORT_FILES,
  EXPORT_SCHEMA_VERSION,
  exportManifestSchema,
  type ExportFile,
  type ExportLink,
  type ExportManifest,
} from '@/domain/export/schema';

/**
 * Builds a user's export archive (FR-22): one JSON file per object type, `links.json` with every
 * relationship, `manifest.json` with versions and counts, zipped. Reads with the service role
 * inside the job, scoped to one `user_id` on every query — the job payload carries only the
 * export id, and the user id comes from that row, never from the caller. Includes raw text,
 * every generation of every interpretation with its versions, the user's feedback words, safety
 * flag categories, and the deck-native identity of every card referenced. Never `ai_calls`
 * (platform telemetry). Soft-deleted readings are excluded: the user deleted them.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();

export interface BuiltExport {
  bytes: Uint8Array;
  manifest: ExportManifest;
}

export async function buildExportArchive(
  userId: string,
  opts: { now?: Date; email?: string | null } = {},
): Promise<BuiltExport> {
  const db = platformDb();
  const now = opts.now ?? new Date();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!profile) throw new Error('profile not found');

  const readingRows = await db
    .select()
    .from(readings)
    .where(and(eq(readings.userId, userId), isNull(readings.deletedAt)))
    .orderBy(readings.occurredAt, readings.id);
  const readingIds = readingRows.map((r) => r.id);
  const inReadings = <T extends { readingId: unknown }>(rows: T[]) => rows;

  const cardRows = readingIds.length
    ? await db
        .select()
        .from(readingCards)
        .where(inArray(readingCards.readingId, readingIds))
        .orderBy(readingCards.readingId, readingCards.positionIndex)
    : [];
  const revisionRows = readingIds.length
    ? inReadings(
        await db
          .select()
          .from(readingNoteRevisions)
          .where(inArray(readingNoteRevisions.readingId, readingIds))
          .orderBy(readingNoteRevisions.replacedAt, readingNoteRevisions.id),
      )
    : [];
  const interpretationRows = readingIds.length
    ? await db
        .select()
        .from(interpretations)
        .where(inArray(interpretations.readingId, readingIds))
        .orderBy(interpretations.createdAt, interpretations.id)
    : [];
  const flagRows = readingIds.length
    ? await db
        .select()
        .from(safetyFlags)
        .where(
          and(
            eq(safetyFlags.userId, userId),
            eq(safetyFlags.objectType, 'reading'),
            inArray(safetyFlags.objectId, readingIds),
          ),
        )
        .orderBy(safetyFlags.createdAt, safetyFlags.id)
    : [];
  const askRows = await db
    .select({
      id: questionEmbeddings.id,
      readingId: questionEmbeddings.readingId,
      questionHash: questionEmbeddings.questionHash,
      model: questionEmbeddings.model,
      nudgeShownAt: questionEmbeddings.nudgeShownAt,
      askedAt: questionEmbeddings.askedAt,
    })
    .from(questionEmbeddings)
    .where(
      and(
        eq(questionEmbeddings.userId, userId),
        or(
          isNull(questionEmbeddings.readingId),
          inArray(questionEmbeddings.readingId, [
            ...readingIds,
            // never an empty IN list
            '00000000-0000-0000-0000-000000000000',
          ]),
        ),
      ),
    )
    .orderBy(questionEmbeddings.askedAt, questionEmbeddings.id);
  const spreadIds = [...new Set(readingRows.map((r) => r.spreadId))];
  const spreadRows = await db
    .select()
    .from(spreads)
    .where(
      spreadIds.length
        ? or(eq(spreads.userId, userId), inArray(spreads.id, spreadIds))
        : eq(spreads.userId, userId),
    )
    .orderBy(spreads.sortOrder, spreads.id);
  const cardIds = [...new Set(cardRows.map((c) => c.cardId))];
  const cardRefRows = cardIds.length
    ? await db
        .select({
          id: cards.id,
          deckId: cards.deckId,
          slug: cards.slug,
          name: cards.name,
          title: cards.title,
          arcana: cards.arcana,
          suit: cards.suit,
          number: cards.number,
        })
        .from(cards)
        .where(inArray(cards.id, cardIds))
        .orderBy(cards.deckId, cards.sortOrder)
    : [];
  const deckRows = await db
    .select({ id: decks.id, slug: decks.slug, name: decks.name, system: decks.system })
    .from(decks)
    .orderBy(decks.sortOrder);
  const receiptRows = await db
    .select()
    .from(deletionReceipts)
    .where(eq(deletionReceipts.userId, userId))
    .orderBy(deletionReceipts.completedAt, deletionReceipts.id);

  const cardsByReading = new Map<string, typeof cardRows>();
  for (const c of cardRows) {
    const list = cardsByReading.get(c.readingId) ?? [];
    list.push(c);
    cardsByReading.set(c.readingId, list);
  }

  const links: ExportLink[] = [];
  const link = (kind: ExportLink['kind'], from: [string, string], to: [string, string]) =>
    links.push({ kind, from: { type: from[0], id: from[1] }, to: { type: to[0], id: to[1] } });

  const files: Record<ExportFile, unknown> = {
    'profile.json': {
      id: profile.id,
      email: opts.email ?? null,
      locale: profile.locale,
      timezone: profile.timezone,
      usage_style: profile.usageStyle,
      experience_level: profile.experienceLevel,
      default_deck_id: profile.defaultDeckId,
      use_reversals: profile.useReversals,
      ai_consent_at: iso(profile.aiConsentAt),
      ai_explanation_depth: profile.aiExplanationDepth,
      plan: profile.plan,
      created_at: isoReq(profile.createdAt),
    },
    'readings.json': readingRows.map((r) => {
      link('reading_uses_spread', ['reading', r.id], ['spread', r.spreadId]);
      link('reading_uses_deck', ['reading', r.id], ['deck', r.deckId]);
      return {
        id: r.id,
        created_at: isoReq(r.createdAt),
        occurred_at: isoReq(r.occurredAt),
        updated_at: isoReq(r.updatedAt),
        question: r.question,
        is_open_reflection: r.isOpenReflection,
        life_area: r.lifeArea,
        spread_id: r.spreadId,
        deck_id: r.deckId,
        source: r.source,
        uses_reversals: r.usesReversals,
        user_notes: r.userNotes,
        follow_up_status: r.followUpStatus,
        revisit_at: iso(r.revisitAt),
        rng: r.rng ?? null,
        metadata_version: r.metadataVersion,
        cards: (cardsByReading.get(r.id) ?? []).map((c) => {
          link('reading_card_is', ['reading_card', c.id], ['card', c.cardId]);
          return {
            id: c.id,
            position_index: c.positionIndex,
            position_key: c.positionKey,
            card_id: c.cardId,
            orientation: c.orientation,
            user_meaning: c.userMeaning,
          };
        }),
      };
    }),
    'note_revisions.json': revisionRows.map((v) => {
      link('revision_of', ['note_revision', v.id], ['reading', v.readingId]);
      return {
        id: v.id,
        reading_id: v.readingId,
        field: v.field,
        content: v.content,
        metadata_version: v.metadataVersion,
        replaced_at: isoReq(v.replacedAt),
      };
    }),
    'interpretations.json': interpretationRows.map((i) => {
      link('interpretation_of', ['interpretation', i.id], ['reading', i.readingId]);
      if (i.supersededBy)
        link('supersedes', ['interpretation', i.supersededBy], ['interpretation', i.id]);
      return {
        id: i.id,
        reading_id: i.readingId,
        status: i.status,
        fact_status: i.factStatus,
        metadata_version: i.metadataVersion,
        depth: i.depth,
        synthesis: i.synthesis,
        per_card: i.perCard ?? null,
        combined: i.combined,
        reflective_prompts: i.reflectivePrompts,
        model_id: i.modelId,
        prompt_version: i.promptVersion,
        schema_version: i.schemaVersion,
        error_class: i.errorClass,
        feedback: i.feedback,
        feedback_reason: i.feedbackReason,
        feedback_at: iso(i.feedbackAt),
        superseded_by: i.supersededBy,
        generated_at: iso(i.generatedAt),
        created_at: isoReq(i.createdAt),
      };
    }),
    'safety_flags.json': flagRows.map((f) => {
      link('safety_flag_on', ['safety_flag', f.id], [f.objectType, f.objectId]);
      return {
        id: f.id,
        object_type: f.objectType,
        object_id: f.objectId,
        category: f.category,
        severity: f.severity,
        surfaced_at: iso(f.surfacedAt),
        created_at: isoReq(f.createdAt),
      };
    }),
    'question_asks.json': askRows.map((a) => {
      if (a.readingId) link('ask_for', ['question_ask', a.id], ['reading', a.readingId]);
      return {
        id: a.id,
        reading_id: a.readingId,
        question_hash: a.questionHash,
        model: a.model,
        nudge_shown_at: iso(a.nudgeShownAt),
        asked_at: isoReq(a.askedAt),
      };
    }),
    'spreads.json': spreadRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      positions: s.positions,
      layout: s.layout,
      is_builtin: s.isBuiltin,
      card_count: s.cardCount,
    })),
    'decks.json': deckRows,
    'cards.json': cardRefRows.map((c) => ({
      id: c.id,
      deck_id: c.deckId,
      slug: c.slug,
      name: c.name,
      title: c.title,
      arcana: c.arcana,
      suit: c.suit,
      number: c.number,
    })),
    'deletion_receipts.json': receiptRows.map((d) => ({
      id: d.id,
      scope: d.scope,
      object_type: d.objectType,
      object_id: d.objectId,
      requested_at: isoReq(d.requestedAt),
      completed_at: isoReq(d.completedAt),
      counts: d.counts as Record<string, number>,
    })),
    'links.json': links,
  };

  const counts = Object.fromEntries(
    EXPORT_FILES.map((name) => [
      name,
      name === 'profile.json' ? 1 : (files[name] as unknown[]).length,
    ]),
  ) as ExportManifest['counts'];

  const manifest = exportManifestSchema.parse({
    schema_version: EXPORT_SCHEMA_VERSION,
    app: 'tarot-journal',
    exported_at: now.toISOString(),
    user_id: userId,
    counts,
    files: [...EXPORT_FILES],
    notes: [
      'Every id is the id the app uses; relationships are listed in links.json.',
      'interpretations.json holds every generation, including superseded ones, with model and prompt versions.',
      'question_asks.json carries hashes of questions, not the text; the text is in readings.json.',
      'Readings you deleted are not included.',
    ],
  } satisfies ExportManifest);

  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (const name of EXPORT_FILES) entries[name] = strToU8(JSON.stringify(files[name], null, 2));
  const bytes = zipSync(entries, { level: 6, mtime: now });
  return { bytes, manifest };
}

/** How many live readings a user has — the count the export UI quotes. */
export async function countLiveReadings(userId: string): Promise<number> {
  const rows = await platformDb().execute<{ n: number }>(
    sql`select count(*)::int as n from public.readings where user_id = ${userId} and deleted_at is null`,
  );
  return Number(rows[0]?.n ?? 0);
}
