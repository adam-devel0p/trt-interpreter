/**
 * The extraction payload (docs/DATA_MODEL.md#derived-metadata--phase-06, spec §7.2). This is
 * what `extract_reading_metadata` must return and what `extractions.payload` stores, versioned
 * by `EXTRACTION_SCHEMA_VERSION`. Everything in it is a proposal: entities are mentions to be
 * resolved by `domain/entities/resolve.ts`, themes are labels to be mapped onto the taxonomy,
 * possibilities are POSSIBILITY-status text and carry no probability — ever (§10).
 */
import { z } from 'zod';
import { LIFE_AREAS } from '../readings/types';

export const EXTRACTION_SCHEMA_VERSION = 'extraction/1.0.0';

export const ENTITY_KINDS = [
  'person',
  'organization',
  'place',
  'project',
  'object',
  'other',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const THEME_CATEGORIES = ['emotional', 'relational', 'situational', 'practical'] as const;
export type ThemeCategory = (typeof THEME_CATEGORIES)[number];

export const POSSIBILITY_KINDS = ['possibility', 'prediction'] as const;

const lifeAreaKeys = LIFE_AREAS.map((a) => a.key) as [string, ...string[]];
const short = z.string().trim().min(1).max(120);
const sentence = z.string().trim().min(1).max(400);
const unit = z.number().min(0).max(1);
/** ISO date (YYYY-MM-DD) or null — the model never returns a resolved instant. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const extractedEntitySchema = z
  .object({
    /** The surface form exactly as written ("my girlfriend", "Alex", "the agency"). */
    mention: short,
    kind: z.enum(ENTITY_KINDS),
    confidence: unit,
    /** Relational framing when the text gives one: partner, friend, colleague, employer… */
    relation: short.nullable().default(null),
    /** The clause the mention sits in, for disambiguation. */
    context: sentence.nullable().default(null),
  })
  .strict();
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

export const extractedThemeSchema = z
  .object({ label: short, category: z.enum(THEME_CATEGORIES), weight: unit })
  .strict();
export type ExtractedTheme = z.infer<typeof extractedThemeSchema>;

export const extractedPossibilitySchema = z
  .object({
    text: sentence,
    category: short.nullable().default(null),
    timeframe: short.nullable().default(null),
    kind: z.enum(POSSIBILITY_KINDS).default('possibility'),
  })
  .strict();
export type ExtractedPossibility = z.infer<typeof extractedPossibilitySchema>;

export const extractionPayloadSchema = z
  .object({
    life_area: z.enum(lifeAreaKeys).nullable().default(null),
    entities: z.array(extractedEntitySchema).max(20).default([]),
    themes: z.array(extractedThemeSchema).max(8).default([]),
    event_mentions: z
      .array(z.object({ text: sentence, when: short.nullable().default(null) }).strict())
      .max(10)
      .default([]),
    goals: z.array(sentence).max(6).default([]),
    fears: z.array(sentence).max(6).default([]),
    decisions: z.array(sentence).max(6).default([]),
    timeframe: z
      .object({ start: isoDate.default(null), end: isoDate.default(null), text: short.nullable() })
      .strict()
      .nullable()
      .default(null),
    possibilities: z.array(extractedPossibilitySchema).max(6).default([]),
    emotional_tone: short.nullable().default(null),
    /** Stored unused until Phase 07. */
    journey_candidates: z
      .array(z.object({ title: short, confidence: unit }).strict())
      .max(3)
      .default([]),
    safety_flags: z.array(short).max(5).default([]),
  })
  .strict();
export type ExtractionPayload = z.infer<typeof extractionPayloadSchema>;

/** The empty payload: what a reading with no usable text extracts to. */
export const EMPTY_PAYLOAD: ExtractionPayload = extractionPayloadSchema.parse({});

// ── Life events (Phase 08) ─────────────────────────────────────────────────────────────────

/** The types the event extractor may propose (stable keys; labels in `domain/events/types.ts`). */
export const EVENT_TYPE_KEYS = [
  'work',
  'relationship',
  'home',
  'health',
  'money',
  'family',
  'travel',
  'learning',
  'loss',
  'milestone',
  'other',
] as const;
export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number];

export const EVENT_EXTRACTION_SCHEMA_VERSION = 'event_extraction/1.0.0';

/**
 * What `extract_event_metadata` returns (spec §6.4): the same family as a reading's payload —
 * it is materialised by the same code into the same tables — plus what only an event has:
 * a type and an importance band (1 passing – 5 life-changing). Strict; no probability.
 */
export const eventExtractionPayloadSchema = extractionPayloadSchema
  .extend({
    event_type: z.enum(EVENT_TYPE_KEYS).nullable().default(null),
    importance: z.number().int().min(1).max(5).nullable().default(null),
  })
  .strict();
export type EventExtractionPayload = z.infer<typeof eventExtractionPayloadSchema>;
