import { and, eq, inArray, isNull } from 'drizzle-orm';
import { platformDb } from '../src/db/admin';
import {
  cards,
  decks,
  interpretations,
  profiles,
  readingCards,
  readings,
  spreads,
} from '../src/db/schema';
import { mockInterpretation } from '../src/ai/tasks/interpret_reading/mock';
import { PROMPT_VERSION, SCHEMA_VERSION } from '../src/ai/tasks/interpret_reading/version';
import { interpretationOutputSchema } from '../src/domain/interpretation/schema';
import { modelWrite } from '../src/domain/facts/writeGate';
import type { SeedContext } from './seed-demo';

/**
 * Phase 04 — stored interpretations for the consenting demo user's readings, so the journal
 * has AI layers to show without a model or a key. Built from the same deterministic mock
 * fixture the e2e suite uses; every row goes through the write gate and carries versions. The
 * readings seeder regenerates readings (and cascades these), so this always runs after it.
 * Users without consent get nothing — exactly as in the product.
 */
export async function seedInterpretations(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedInterpretations needs the users seeder first');
  const declined = new Set(
    (
      await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(inArray(profiles.id, userIds), isNull(profiles.aiConsentAt)))
    ).map((p) => p.id),
  );

  const rows = await db
    .select({
      id: readings.id,
      userId: readings.userId,
      question: readings.question,
      isOpen: readings.isOpenReflection,
      notes: readings.userNotes,
      occurredAt: readings.occurredAt,
      deckSystem: decks.system,
      positions: spreads.positions,
      metadataVersion: readings.metadataVersion,
    })
    .from(readings)
    .innerJoin(decks, eq(decks.id, readings.deckId))
    .innerJoin(spreads, eq(spreads.id, readings.spreadId))
    .where(inArray(readings.userId, userIds));

  let total = 0;
  for (const r of rows) {
    if (declined.has(r.userId)) continue;
    const drawn = await db
      .select({
        positionIndex: readingCards.positionIndex,
        cardId: readingCards.cardId,
        name: cards.name,
        keyword: cards.keywordsUpright,
      })
      .from(readingCards)
      .innerJoin(cards, eq(cards.id, readingCards.cardId))
      .where(eq(readingCards.readingId, r.id))
      .orderBy(readingCards.positionIndex);
    const positions = r.positions as { name: string }[];
    const value = mockInterpretation({
      task: 'interpret_reading',
      system: '',
      messages: [],
      mockInput: {
        deckSystem: r.deckSystem,
        cards: drawn.map((c) => ({
          position_index: c.positionIndex,
          position_name: positions[c.positionIndex]?.name ?? `Position ${c.positionIndex + 1}`,
          name: c.name,
          keyword: (c.keyword as string[])[0] ?? '',
        })),
        question: r.isOpen ? null : r.question,
        hasNote: Boolean(r.notes),
      },
    }) as { per_card: { position_index: number }[] };
    const output = interpretationOutputSchema.parse({
      ...value,
      per_card: value.per_card.map((c) => ({
        ...c,
        card_id: drawn.find((d) => d.positionIndex === c.position_index)!.cardId,
      })),
    });
    const gated = modelWrite('TAROT_INTERPRETATION', output);
    const generatedAt = new Date(r.occurredAt.getTime() + 45_000);
    await db.insert(interpretations).values({
      readingId: r.id,
      userId: r.userId,
      status: 'complete',
      factStatus: gated.fact_status,
      metadataVersion: r.metadataVersion,
      depth: 'standard',
      synthesis: gated.payload.synthesis,
      perCard: gated.payload.per_card,
      combined: gated.payload.combined,
      reflectivePrompts: gated.payload.reflective_prompts,
      modelId: 'mock/claude-opus-5',
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      tokensIn: 1800,
      tokensOut: 420,
      costMicros: 0,
      latencyMs: 9000,
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    total++;
  }
  console.log(`  ${total} interpretations for consenting demo users`);
}
