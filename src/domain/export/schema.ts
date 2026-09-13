/**
 * Export archive contract (FR-22, §13 data portability). Pure Zod: the builder produces it,
 * the round-trip test and any future importer validate against it. One file per object type,
 * a `links.json` naming every relationship, and a `manifest.json` with versions and counts.
 * IDs are the database IDs, so a person can leave without losing the graph.
 */
import { z } from 'zod';

export const EXPORT_SCHEMA_VERSION = 'export/1.0.0';

export const EXPORT_FILES = [
  'profile.json',
  'readings.json',
  'note_revisions.json',
  'interpretations.json',
  'safety_flags.json',
  'question_asks.json',
  'spreads.json',
  'decks.json',
  'cards.json',
  'deletion_receipts.json',
  'links.json',
] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

const iso = z.string().min(1);
const uuid = z.string().uuid();

export const exportManifestSchema = z
  .object({
    schema_version: z.literal(EXPORT_SCHEMA_VERSION),
    app: z.literal('tarot-journal'),
    exported_at: iso,
    user_id: uuid,
    /** Rows per file. */
    counts: z.record(z.enum(EXPORT_FILES), z.number().int().min(0)),
    files: z.array(z.enum(EXPORT_FILES)),
    notes: z.array(z.string()),
  })
  .strict();
export type ExportManifest = z.infer<typeof exportManifestSchema>;

export const exportReadingCardSchema = z
  .object({
    id: uuid,
    position_index: z.number().int().min(0),
    position_key: z.string(),
    card_id: uuid,
    orientation: z.enum(['upright', 'reversed']),
    user_meaning: z.string().nullable(),
  })
  .strict();

export const exportReadingSchema = z
  .object({
    id: uuid,
    created_at: iso,
    occurred_at: iso,
    updated_at: iso,
    question: z.string().nullable(),
    is_open_reflection: z.boolean(),
    life_area: z.string().nullable(),
    spread_id: uuid,
    deck_id: uuid,
    source: z.enum(['digital', 'physical']),
    uses_reversals: z.boolean(),
    user_notes: z.string().nullable(),
    follow_up_status: z.string(),
    revisit_at: iso.nullable(),
    rng: z.unknown().nullable(),
    metadata_version: z.number().int().min(1),
    cards: z.array(exportReadingCardSchema),
  })
  .strict();

export const exportNoteRevisionSchema = z
  .object({
    id: uuid,
    reading_id: uuid,
    field: z.enum(['user_notes', 'question']),
    content: z.string(),
    metadata_version: z.number().int(),
    replaced_at: iso,
  })
  .strict();

export const exportInterpretationSchema = z
  .object({
    id: uuid,
    reading_id: uuid,
    status: z.string(),
    fact_status: z.literal('TAROT_INTERPRETATION'),
    metadata_version: z.number().int(),
    depth: z.string(),
    synthesis: z.string().nullable(),
    per_card: z.unknown().nullable(),
    combined: z.string().nullable(),
    reflective_prompts: z.array(z.string()).nullable(),
    model_id: z.string().nullable(),
    prompt_version: z.string(),
    schema_version: z.string(),
    error_class: z.string().nullable(),
    feedback: z.number().int().nullable(),
    feedback_reason: z.string().nullable(),
    feedback_at: iso.nullable(),
    superseded_by: uuid.nullable(),
    generated_at: iso.nullable(),
    created_at: iso,
  })
  .strict();

export const exportSafetyFlagSchema = z
  .object({
    id: uuid,
    object_type: z.string(),
    object_id: uuid,
    category: z.string(),
    severity: z.string(),
    surfaced_at: iso.nullable(),
    created_at: iso,
  })
  .strict();

/** Hash and link only — the vector is a derived artifact of no use outside the app. */
export const exportQuestionAskSchema = z
  .object({
    id: uuid,
    reading_id: uuid.nullable(),
    question_hash: z.string(),
    model: z.string(),
    nudge_shown_at: iso.nullable(),
    asked_at: iso,
  })
  .strict();

export const exportSpreadSchema = z
  .object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    positions: z.unknown(),
    layout: z.unknown(),
    is_builtin: z.boolean(),
    card_count: z.number().int(),
  })
  .strict();

export const exportDeckSchema = z
  .object({ id: uuid, slug: z.string(), name: z.string(), system: z.enum(['rws', 'thoth']) })
  .strict();

/** Reference identity for every card the archive mentions, deck-native (§6.7). */
export const exportCardSchema = z
  .object({
    id: uuid,
    deck_id: uuid,
    slug: z.string(),
    name: z.string(),
    title: z.string().nullable(),
    arcana: z.enum(['major', 'minor']),
    suit: z.string().nullable(),
    number: z.number().int().nullable(),
  })
  .strict();

export const exportReceiptSchema = z
  .object({
    id: uuid,
    scope: z.string(),
    object_type: z.string().nullable(),
    object_id: uuid.nullable(),
    requested_at: iso,
    completed_at: iso,
    counts: z.record(z.string(), z.number().int()),
  })
  .strict();

export const exportProfileSchema = z
  .object({
    id: uuid,
    email: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
    usage_style: z.string().nullable(),
    experience_level: z.string().nullable(),
    default_deck_id: uuid.nullable(),
    use_reversals: z.boolean(),
    ai_consent_at: iso.nullable(),
    ai_explanation_depth: z.string(),
    plan: z.string(),
    created_at: iso,
  })
  .strict();

export const LINK_KINDS = [
  'reading_uses_spread',
  'reading_uses_deck',
  'reading_card_is',
  'revision_of',
  'interpretation_of',
  'supersedes',
  'safety_flag_on',
  'ask_for',
] as const;

export const exportLinkSchema = z
  .object({
    kind: z.enum(LINK_KINDS),
    from: z.object({ type: z.string(), id: uuid }).strict(),
    to: z.object({ type: z.string(), id: uuid }).strict(),
  })
  .strict();
export type ExportLink = z.infer<typeof exportLinkSchema>;

export const EXPORT_FILE_SCHEMAS = {
  'profile.json': exportProfileSchema,
  'readings.json': z.array(exportReadingSchema),
  'note_revisions.json': z.array(exportNoteRevisionSchema),
  'interpretations.json': z.array(exportInterpretationSchema),
  'safety_flags.json': z.array(exportSafetyFlagSchema),
  'question_asks.json': z.array(exportQuestionAskSchema),
  'spreads.json': z.array(exportSpreadSchema),
  'decks.json': z.array(exportDeckSchema),
  'cards.json': z.array(exportCardSchema),
  'deletion_receipts.json': z.array(exportReceiptSchema),
  'links.json': z.array(exportLinkSchema),
} as const satisfies Record<ExportFile, z.ZodType>;

/** Validate a decoded archive: every file present and well-formed, counts match the manifest. */
export function validateExport(files: Record<string, unknown>): {
  manifest: ExportManifest;
  problems: string[];
} {
  const problems: string[] = [];
  const m = exportManifestSchema.safeParse(files['manifest.json']);
  if (!m.success) return { manifest: null as never, problems: ['manifest.json invalid'] };
  for (const name of EXPORT_FILES) {
    const r = EXPORT_FILE_SCHEMAS[name].safeParse(files[name]);
    if (!r.success) {
      problems.push(`${name}: ${r.error.issues[0]?.message ?? 'invalid'}`);
      continue;
    }
    const n = name === 'profile.json' ? 1 : (r.data as unknown[]).length;
    if (m.data.counts[name] !== n)
      problems.push(`${name}: manifest says ${m.data.counts[name]}, has ${n}`);
  }
  return { manifest: m.data, problems };
}
