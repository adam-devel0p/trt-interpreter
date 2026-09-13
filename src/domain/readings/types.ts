/**
 * Reading domain types (docs/DATA_MODEL.md#readings--phase-03). Pure: shared by the draft
 * machine, the query layer, the seed and the UI.
 */
import { z } from 'zod';
import { CUSTOM_SPREAD_MAX_POSITIONS } from './thresholds';

export const ORIENTATIONS = ['upright', 'reversed'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const READING_SOURCES = ['digital', 'physical'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export const FOLLOW_UP_STATUSES = [
  'unresolved',
  'partly_resolved',
  'resolved',
  'not_relevant',
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = {
  unresolved: 'Unresolved',
  partly_resolved: 'Partly resolved',
  resolved: 'Resolved',
  not_relevant: 'No longer relevant',
};

/** Optional life-area chips (§6.2 step 15). Keys are stable; labels are display-only. */
export const LIFE_AREAS = [
  { key: 'relationships', label: 'Relationships' },
  { key: 'work', label: 'Work' },
  { key: 'money', label: 'Money' },
  { key: 'health', label: 'Health' },
  { key: 'home', label: 'Home' },
  { key: 'creativity', label: 'Creativity' },
  { key: 'self', label: 'Self' },
  { key: 'family', label: 'Family' },
] as const;
export type LifeAreaKey = (typeof LIFE_AREAS)[number]['key'];
const LIFE_AREA_KEYS = LIFE_AREAS.map((a) => a.key) as [LifeAreaKey, ...LifeAreaKey[]];

export const QUESTION_MAX = 500;
export const NOTES_MAX = 5000;

export const placedCardSchema = z
  .object({
    position_index: z
      .number()
      .int()
      .min(0)
      .max(CUSTOM_SPREAD_MAX_POSITIONS - 1),
    card_id: z.string().uuid(),
    orientation: z.enum(ORIENTATIONS),
  })
  .strict();
export type PlacedCard = z.infer<typeof placedCardSchema>;

export const drawRecordSchema = z
  .object({
    algorithm: z.literal('fisher-yates/xoshiro128**'),
    seed: z.string().regex(/^[0-9a-f]{32}$/),
    drawn_at: z.string().datetime({ offset: true }),
    deck_id: z.string().uuid(),
    deck_size: z.number().int().positive(),
    reversal_probability: z.number().min(0).max(1),
  })
  .strict();

/** What the save action accepts. Every field the user could not have set is absent. */
export const createReadingInputSchema = z
  .object({
    question: z.string().trim().max(QUESTION_MAX).nullable(),
    is_open_reflection: z.boolean(),
    life_area: z.enum(LIFE_AREA_KEYS).nullable(),
    spread_id: z.string().uuid(),
    deck_id: z.string().uuid(),
    source: z.enum(READING_SOURCES),
    uses_reversals: z.boolean(),
    cards: z.array(placedCardSchema).min(1).max(CUSTOM_SPREAD_MAX_POSITIONS),
    user_notes: z.string().trim().max(NOTES_MAX).nullable(),
    occurred_at: z.string().datetime({ offset: true }).nullable(),
    rng: drawRecordSchema.nullable(),
  })
  .strict()
  .refine(
    (r) => r.cards.every((c, i) => c.position_index === i),
    'cards are indexed 0..n-1 in order',
  )
  .refine(
    (r) => new Set(r.cards.map((c) => c.card_id)).size === r.cards.length,
    'a card appears at most once',
  )
  .refine((r) => r.is_open_reflection || (r.question ?? '').length > 0, {
    message: 'a question or open reflection',
    path: ['question'],
  })
  .refine((r) => r.uses_reversals || r.cards.every((c) => c.orientation === 'upright'), {
    message: 'reversed cards on a reading that does not use reversals',
    path: ['cards'],
  })
  .refine((r) => (r.source === 'digital') === (r.rng !== null), {
    message: 'digital readings carry a draw record; physical ones do not',
    path: ['rng'],
  });
export type CreateReadingInput = z.infer<typeof createReadingInputSchema>;

/** Editable metadata after save. Cards are replaced separately and atomically. */
export const updateReadingInputSchema = z
  .object({
    question: z.string().trim().max(QUESTION_MAX).nullable(),
    is_open_reflection: z.boolean(),
    life_area: z.enum(LIFE_AREA_KEYS).nullable(),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((r) => r.is_open_reflection || (r.question ?? '').length > 0, {
    message: 'a question or open reflection',
    path: ['question'],
  });
export type UpdateReadingInput = z.infer<typeof updateReadingInputSchema>;
