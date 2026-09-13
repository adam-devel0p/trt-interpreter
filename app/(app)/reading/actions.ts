'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { HOME_PATH } from '@/auth/routes';
import { getSessionClient, requireUser } from '@/auth/session';
import { getDeckById, listCards } from '@/db/queries/decks';
import {
  createReading,
  deleteReading,
  deleteServerDraft,
  replaceReadingCards,
  setFollowUpStatus,
  setRevisitAt,
  updateReading,
  updateReadingNotes,
  upsertServerDraft,
} from '@/db/queries/readings';
import {
  createCustomSpread,
  customSpreadInputSchema,
  deleteCustomSpread,
} from '@/db/queries/spreads';
import {
  FEEDBACK_REASON_MAX,
  linkQuestionAsk,
  setInterpretationFeedback,
} from '@/db/queries/interpretations';
import { readingDraftSchema, type ReadingDraft } from '@/domain/readings/draft';
import { drawCards, type DrawnCard, type DrawRecord } from '@/domain/readings/draw';
import {
  createReadingInputSchema,
  FOLLOW_UP_STATUSES,
  NOTES_MAX,
  placedCardSchema,
  updateReadingInputSchema,
  type CreateReadingInput,
  type FollowUpStatus,
  type PlacedCard,
  type UpdateReadingInput,
} from '@/domain/readings/types';
import { SEED_BYTES } from '@/domain/readings/prng';
import { CUSTOM_SPREAD_MAX_POSITIONS } from '@/domain/readings/thresholds';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * The reading loop's server actions. None of them touch `src/ai/` — the whole phase is
 * model-free by design (invariant: content saves before AI; opening a reading makes no AI
 * call). Every write goes through the RLS-respecting session client; every input is
 * re-validated here regardless of what the client sent. Log lines carry IDs and classes only.
 */

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const SAVE_FAILED =
  "That didn't save. Nothing you entered is lost — it's still on this screen. Try again.";
const GENERIC_FAILED = "That didn't go through. Your reading is unchanged — try again.";

// ── Draw ──────────────────────────────────────────────────────────────────────────────────

const drawInputSchema = z
  .object({
    deckId: z.string().uuid(),
    count: z.number().int().min(1).max(CUSTOM_SPREAD_MAX_POSITIONS),
    usesReversals: z.boolean(),
  })
  .strict();

/**
 * Server-side RNG draw (FR-04). The seed comes from `crypto.randomBytes`; the deck's card list
 * in `sort_order` is the universe; reversals are suppressed when the deck does not read them,
 * whatever the client asked for (§6.7).
 */
export async function drawCardsAction(
  raw: unknown,
): Promise<ActionResult<{ cards: DrawnCard[]; rng: DrawRecord }>> {
  const user = await requireUser();
  const parsed = drawInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: GENERIC_FAILED };
  const client = await getSessionClient();
  try {
    const deck = await getDeckById(client, parsed.data.deckId);
    if (!deck) return { ok: false, message: GENERIC_FAILED };
    const cardIds = (await listCards(client, deck)).map((c) => c.id);
    const result = drawCards({
      cardIds,
      deckId: deck.id,
      count: parsed.data.count,
      usesReversals: deck.supports_reversals && parsed.data.usesReversals,
      seed: randomBytes(SEED_BYTES).toString('hex'),
    });
    logger.info('app.reading.drawn', { userId: user.id, count: parsed.data.count });
    return { ok: true, value: result };
  } catch (err) {
    logger.warn('app.reading.draw_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: 'The draw did not go through. Try again in a moment.' };
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────────────────

/** Transactional save; on success the server draft is cleared and the caller navigates. */
export async function saveReadingAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = createReadingInputSchema.safeParse(raw);
  if (!parsed.success) {
    logger.info('app.reading.save_rejected', { userId: user.id });
    return { ok: false, message: SAVE_FAILED };
  }
  const client = await getSessionClient();
  try {
    const id = await createReading(client, parsed.data as CreateReadingInput);
    await deleteServerDraft(client, user.id).catch(() => undefined);
    // FR-25: attach the pre-draw question ask (if one was checked) to this reading. No model.
    if (parsed.data.question && !parsed.data.is_open_reflection) {
      await linkQuestionAsk(client, user.id, parsed.data.question, id).catch(() => undefined);
    }
    logger.info('app.reading.saved', {
      userId: user.id,
      objectType: 'reading',
      objectId: id,
      count: parsed.data.cards.length,
    });
    revalidatePath(HOME_PATH);
    return { ok: true, value: { id } };
  } catch (err) {
    logger.warn('app.reading.save_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: SAVE_FAILED };
  }
}

// ── Server draft ──────────────────────────────────────────────────────────────────────────

export async function saveDraftAction(raw: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = readingDraftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: GENERIC_FAILED };
  try {
    await upsertServerDraft(await getSessionClient(), user.id, parsed.data as ReadingDraft);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.reading.draft_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: GENERIC_FAILED };
  }
}

export async function clearDraftAction(): Promise<void> {
  const user = await requireUser();
  await deleteServerDraft(await getSessionClient(), user.id).catch(() => undefined);
}

// ── Detail-screen writes ──────────────────────────────────────────────────────────────────

async function readingWrite(
  id: unknown,
  write: (client: Awaited<ReturnType<typeof getSessionClient>>, readingId: string) => Promise<void>,
  event: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const readingId = z.string().uuid().safeParse(id);
  if (!readingId.success) return { ok: false, message: GENERIC_FAILED };
  try {
    await write(await getSessionClient(), readingId.data);
    logger.info(`app.reading.${event}`, {
      userId: user.id,
      objectType: 'reading',
      objectId: readingId.data,
    });
    revalidatePath(`/reading/${readingId.data}`);
    revalidatePath(HOME_PATH);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn(`app.reading.${event}_failed`, {
      userId: user.id,
      objectId: readingId.data,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: GENERIC_FAILED };
  }
}

export async function updateNotesAction(id: unknown, notes: unknown): Promise<ActionResult> {
  const text = z.string().max(NOTES_MAX).safeParse(notes);
  if (!text.success) return { ok: false, message: 'That note is too long to save.' };
  return readingWrite(id, (c, rid) => updateReadingNotes(c, rid, text.data), 'notes_saved');
}

export async function setFollowUpAction(id: unknown, status: unknown): Promise<ActionResult> {
  const s = z.enum(FOLLOW_UP_STATUSES).safeParse(status);
  if (!s.success) return { ok: false, message: GENERIC_FAILED };
  return readingWrite(
    id,
    (c, rid) => setFollowUpStatus(c, rid, s.data as FollowUpStatus),
    'follow_up_set',
  );
}

export async function setRevisitAction(id: unknown, revisitAt: unknown): Promise<ActionResult> {
  const at = z.string().datetime({ offset: true }).nullable().safeParse(revisitAt);
  if (!at.success) return { ok: false, message: GENERIC_FAILED };
  return readingWrite(id, (c, rid) => setRevisitAt(c, rid, at.data), 'revisit_set');
}

/** Metadata + cards edit. Cards are replaced atomically after the metadata write. */
export async function updateReadingAction(
  id: unknown,
  meta: unknown,
  cards: unknown,
): Promise<ActionResult> {
  const m = updateReadingInputSchema.safeParse(meta);
  const c = z.array(placedCardSchema).min(1).max(CUSTOM_SPREAD_MAX_POSITIONS).safeParse(cards);
  if (!m.success || !c.success) return { ok: false, message: GENERIC_FAILED };
  return readingWrite(
    id,
    async (client, rid) => {
      await updateReading(client, rid, m.data as UpdateReadingInput);
      await replaceReadingCards(client, rid, c.data as PlacedCard[]);
    },
    'edited',
  );
}

export async function deleteReadingAction(id: unknown): Promise<ActionResult> {
  const result = await readingWrite(
    id,
    async (client, rid) => {
      const gone = await deleteReading(client, rid);
      if (!gone) throw new Error('not found');
    },
    'deleted',
  );
  if (result.ok) redirect(HOME_PATH);
  return result;
}

/** Thumbs + optional reason on an interpretation (§16). A user write; never logged. */
export async function setInterpretationFeedbackAction(
  interpretationId: unknown,
  feedback: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid(),
      feedback: z.union([z.literal(1), z.literal(-1)]).nullable(),
      reason: z.string().max(FEEDBACK_REASON_MAX).nullable(),
    })
    .safeParse({ id: interpretationId, feedback, reason });
  if (!parsed.success) return { ok: false, message: GENERIC_FAILED };
  try {
    await setInterpretationFeedback(
      await getSessionClient(),
      parsed.data.id,
      parsed.data.feedback,
      parsed.data.reason,
    );
    logger.info('app.interpretation.feedback', {
      userId: user.id,
      objectType: 'interpretation',
      objectId: parsed.data.id,
    });
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.interpretation.feedback_failed', {
      userId: user.id,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: GENERIC_FAILED };
  }
}

// ── Custom spreads (FR-05) ────────────────────────────────────────────────────────────────

export async function createSpreadAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = customSpreadInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'Give the spread a name and every position a name.' };
  }
  try {
    const spread = await createCustomSpread(await getSessionClient(), user.id, parsed.data);
    logger.info('app.spread.created', {
      userId: user.id,
      objectType: 'spread',
      objectId: spread.id,
    });
    revalidatePath('/reading/new');
    revalidatePath('/reading/spread/new');
    return { ok: true, value: { id: spread.id } };
  } catch (err) {
    logger.warn('app.spread.create_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: "That spread didn't save. Try again." };
  }
}

export async function deleteSpreadAction(id: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const spreadId = z.string().uuid().safeParse(id);
  if (!spreadId.success) return { ok: false, message: GENERIC_FAILED };
  try {
    const outcome = await deleteCustomSpread(await getSessionClient(), spreadId.data);
    if (outcome === 'in_use') {
      return {
        ok: false,
        message:
          'This spread is used by one of your readings, so it stays. Readings keep their spread.',
      };
    }
    logger.info('app.spread.deleted', {
      userId: user.id,
      objectType: 'spread',
      objectId: spreadId.data,
    });
    revalidatePath('/reading/new');
    revalidatePath('/reading/spread/new');
    return { ok: true, value: undefined };
  } catch (err) {
    logger.warn('app.spread.delete_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: GENERIC_FAILED };
  }
}
