/**
 * The reading-creation draft (§6.2), as a pure state machine. The client component holds one
 * `ReadingDraft`, every interaction is a reducer here, and the object is what gets persisted to
 * sessionStorage (and to `reading_drafts` once a card exists) so a refresh or a backgrounded tab
 * resumes exactly where it was. Rules encoded here, not in the UI:
 *   - every optional step is skippable; only question-or-open-reflection, spread, deck, source
 *     and a full set of cards gate progress;
 *   - back never loses entered cards;
 *   - cards are deck-scoped, so changing deck clears them; a digital draw is tied to its spread
 *     size and source, so changing those clears a draw; physical cards survive a spread resize;
 *   - reversals exist only when the deck supports them and the person uses them.
 */
import { z } from 'zod';
import type { DrawRecord } from './draw';
import {
  createReadingInputSchema,
  drawRecordSchema,
  LIFE_AREAS,
  NOTES_MAX,
  ORIENTATIONS,
  QUESTION_MAX,
  READING_SOURCES,
  type CreateReadingInput,
  type LifeAreaKey,
  type Orientation,
  type ReadingSource,
} from './types';

export const FLOW_STEPS = [
  'question',
  'life_area',
  'spread',
  'deck',
  'source',
  'cards',
  'notes',
] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const DRAFT_VERSION = 1;

const draftCardSchema = z
  .object({ card_id: z.string().uuid(), orientation: z.enum(ORIENTATIONS) })
  .strict();
export type DraftCard = z.infer<typeof draftCardSchema>;

export const readingDraftSchema = z
  .object({
    version: z.literal(DRAFT_VERSION),
    step: z.enum(FLOW_STEPS),
    question: z.string().max(QUESTION_MAX),
    is_open_reflection: z.boolean(),
    life_area: z.enum(LIFE_AREAS.map((a) => a.key) as [LifeAreaKey, ...LifeAreaKey[]]).nullable(),
    spread_id: z.string().uuid().nullable(),
    deck_id: z.string().uuid().nullable(),
    source: z.enum(READING_SOURCES).nullable(),
    uses_reversals: z.boolean(),
    cards: z.array(draftCardSchema.nullable()),
    user_notes: z.string().max(NOTES_MAX),
    occurred_at: z.string().datetime({ offset: true }).nullable(),
    rng: drawRecordSchema.nullable(),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type ReadingDraft = z.infer<typeof readingDraftSchema>;

export interface DeckInfo {
  id: string;
  supports_reversals: boolean;
}
export interface SpreadInfo {
  id: string;
  card_count: number;
}

export interface DraftDefaults {
  deck: DeckInfo | null;
  /** From `profiles.usage_style`; `both`/null → digital. */
  source: ReadingSource;
  /** `profiles.use_reversals`. */
  useReversals: boolean;
  now?: Date;
}

export function newDraft(d: DraftDefaults): ReadingDraft {
  return {
    version: DRAFT_VERSION,
    step: 'question',
    question: '',
    is_open_reflection: false,
    life_area: null,
    spread_id: null,
    deck_id: d.deck?.id ?? null,
    source: d.source,
    uses_reversals: effectiveReversals(d.deck, d.useReversals),
    cards: [],
    user_notes: '',
    occurred_at: null,
    rng: null,
    updated_at: (d.now ?? new Date()).toISOString(),
  };
}

/** Effective reversals for a reading (§6.7): the deck must support them and the person use them. */
export function effectiveReversals(deck: DeckInfo | null, useReversals: boolean): boolean {
  return Boolean(deck?.supports_reversals) && useReversals;
}

/** Parse a persisted draft; anything malformed or from another version is discarded. */
export function restoreDraft(raw: unknown): ReadingDraft | null {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = readingDraftSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function stepIndex(step: FlowStep): number {
  return FLOW_STEPS.indexOf(step);
}

export function nextStep(step: FlowStep): FlowStep | null {
  return FLOW_STEPS[stepIndex(step) + 1] ?? null;
}

export function prevStep(step: FlowStep): FlowStep | null {
  return stepIndex(step) === 0 ? null : FLOW_STEPS[stepIndex(step) - 1]!;
}

/** Which steps can be skipped with nothing entered (§6.2: never require a life area). */
export function isOptionalStep(step: FlowStep): boolean {
  return step === 'life_area' || step === 'notes';
}

export function cardsComplete(d: ReadingDraft): boolean {
  return d.cards.length > 0 && d.cards.every((c) => c !== null);
}

export function canAdvance(d: ReadingDraft, step: FlowStep = d.step): boolean {
  switch (step) {
    case 'question':
      return d.is_open_reflection || d.question.trim().length > 0;
    case 'life_area':
      return true;
    case 'spread':
      return d.spread_id !== null;
    case 'deck':
      return d.deck_id !== null;
    case 'source':
      return d.source !== null;
    case 'cards':
      return cardsComplete(d);
    case 'notes':
      return true;
  }
}

/** Is every step up to and including `step` satisfied? A step that cannot be completed is never shown. */
export function reachable(d: ReadingDraft, step: FlowStep): boolean {
  for (const s of FLOW_STEPS) {
    if (s === step) return true;
    if (!canAdvance(d, s)) return false;
  }
  return true;
}

export function advance(d: ReadingDraft, now = new Date()): ReadingDraft {
  const next = nextStep(d.step);
  if (!next || !canAdvance(d)) return d;
  return touch({ ...d, step: next }, now);
}

/** Back never discards anything: cards, question and notes all stay in the draft. */
export function back(d: ReadingDraft, now = new Date()): ReadingDraft {
  const prev = prevStep(d.step);
  return prev ? touch({ ...d, step: prev }, now) : d;
}

export function goTo(d: ReadingDraft, step: FlowStep, now = new Date()): ReadingDraft {
  return reachable(d, step) ? touch({ ...d, step }, now) : d;
}

export function setQuestion(d: ReadingDraft, question: string, now = new Date()): ReadingDraft {
  return touch({ ...d, question: question.slice(0, QUESTION_MAX), is_open_reflection: false }, now);
}

export function setOpenReflection(d: ReadingDraft, now = new Date()): ReadingDraft {
  return touch({ ...d, is_open_reflection: true, question: '' }, now);
}

export function setLifeArea(
  d: ReadingDraft,
  life_area: LifeAreaKey | null,
  now = new Date(),
): ReadingDraft {
  return touch({ ...d, life_area }, now);
}

/**
 * Choosing a spread sizes the card slots. Physical cards already entered are kept (truncated or
 * padded); a digital draw is discarded because it was drawn for a different spread.
 */
export function setSpread(d: ReadingDraft, spread: SpreadInfo, now = new Date()): ReadingDraft {
  if (d.spread_id === spread.id && d.cards.length === spread.card_count) return d;
  const keep = d.source === 'physical';
  const cards: (DraftCard | null)[] = Array.from({ length: spread.card_count }, (_, i) =>
    keep ? (d.cards[i] ?? null) : null,
  );
  return touch({ ...d, spread_id: spread.id, cards, rng: null }, now);
}

/** Cards are deck-scoped (§6.7): a different deck empties every slot and re-derives reversals. */
export function setDeck(
  d: ReadingDraft,
  deck: DeckInfo,
  useReversals: boolean,
  now = new Date(),
): ReadingDraft {
  const uses_reversals = effectiveReversals(deck, useReversals);
  if (d.deck_id === deck.id) {
    if (d.uses_reversals === uses_reversals) return d;
    return touch(
      { ...d, uses_reversals, cards: uses_reversals ? d.cards : uprightAll(d.cards) },
      now,
    );
  }
  return touch(
    { ...d, deck_id: deck.id, uses_reversals, cards: d.cards.map(() => null), rng: null },
    now,
  );
}

/** Switching source empties the slots: drawn cards are not "entered" and vice versa. */
export function setSource(d: ReadingDraft, source: ReadingSource, now = new Date()): ReadingDraft {
  if (d.source === source) return d;
  return touch({ ...d, source, cards: d.cards.map(() => null), rng: null, occurred_at: null }, now);
}

export function placeCard(
  d: ReadingDraft,
  index: number,
  card_id: string,
  now = new Date(),
): ReadingDraft {
  if (index < 0 || index >= d.cards.length) return d;
  if (d.cards.some((c, i) => c?.card_id === card_id && i !== index)) return d;
  const cards = d.cards.slice();
  cards[index] = { card_id, orientation: 'upright' };
  return touch({ ...d, cards }, now);
}

export function removeCard(d: ReadingDraft, index: number, now = new Date()): ReadingDraft {
  if (!d.cards[index]) return d;
  const cards = d.cards.slice();
  cards[index] = null;
  return touch({ ...d, cards }, now);
}

export function toggleOrientation(d: ReadingDraft, index: number, now = new Date()): ReadingDraft {
  const card = d.cards[index];
  if (!card || !d.uses_reversals) return d;
  const orientation: Orientation = card.orientation === 'upright' ? 'reversed' : 'upright';
  const cards = d.cards.slice();
  cards[index] = { ...card, orientation };
  return touch({ ...d, cards }, now);
}

/** Reorder by swapping two slots (drag-free, keyboard-friendly). */
export function swapCards(d: ReadingDraft, a: number, b: number, now = new Date()): ReadingDraft {
  if (a === b || !inRange(d, a) || !inRange(d, b)) return d;
  const cards = d.cards.slice();
  const t = cards[a] ?? null;
  cards[a] = cards[b] ?? null;
  cards[b] = t;
  return touch({ ...d, cards }, now);
}

export function applyDraw(
  d: ReadingDraft,
  drawn: readonly { position_index: number; card_id: string; orientation: Orientation }[],
  rng: DrawRecord,
  now = new Date(),
): ReadingDraft {
  if (d.source !== 'digital' || drawn.length !== d.cards.length) return d;
  const cards = d.cards.map(() => null as DraftCard | null);
  for (const c of drawn)
    cards[c.position_index] = { card_id: c.card_id, orientation: c.orientation };
  return touch({ ...d, cards, rng }, now);
}

export function setNotes(d: ReadingDraft, user_notes: string, now = new Date()): ReadingDraft {
  return touch({ ...d, user_notes: user_notes.slice(0, NOTES_MAX) }, now);
}

/** Back-dating is for physical readings done earlier; null means "now". */
export function setOccurredAt(
  d: ReadingDraft,
  occurred_at: string | null,
  now = new Date(),
): ReadingDraft {
  return touch({ ...d, occurred_at }, now);
}

export function nextEmptySlot(d: ReadingDraft, from = 0): number | null {
  for (let i = 0; i < d.cards.length; i++) {
    const k = (from + i) % d.cards.length;
    if (d.cards[k] === null) return k;
  }
  return null;
}

/** True once anything worth keeping server-side exists (a placed or drawn card). */
export function hasCards(d: ReadingDraft): boolean {
  return d.cards.some((c) => c !== null);
}

export function toCreateInput(d: ReadingDraft): CreateReadingInput {
  if (!d.spread_id || !d.deck_id || !d.source) throw new Error('draft is incomplete');
  const cards = d.cards.map((c, position_index) => {
    if (!c) throw new Error('draft is incomplete');
    return { position_index, card_id: c.card_id, orientation: c.orientation };
  });
  return createReadingInputSchema.parse({
    question: d.is_open_reflection ? null : d.question.trim() || null,
    is_open_reflection: d.is_open_reflection,
    life_area: d.life_area,
    spread_id: d.spread_id,
    deck_id: d.deck_id,
    source: d.source,
    uses_reversals: d.uses_reversals,
    cards,
    user_notes: d.user_notes.trim() || null,
    occurred_at: d.occurred_at,
    rng: d.rng,
  });
}

function uprightAll(cards: (DraftCard | null)[]): (DraftCard | null)[] {
  return cards.map((c) => (c ? { ...c, orientation: 'upright' } : c));
}

function inRange(d: ReadingDraft, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < d.cards.length;
}

function touch(d: ReadingDraft, now: Date): ReadingDraft {
  return { ...d, updated_at: now.toISOString() };
}
