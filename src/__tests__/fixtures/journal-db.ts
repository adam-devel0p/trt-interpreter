import {
  getDeckBySlug,
  listCards,
  listSpreads,
  type DeckRow,
  type SpreadView,
} from '@/db/queries/decks';
import {
  completeInterpretation,
  createPendingInterpretation,
  insertQuestionAsk,
  linkQuestionAsk,
  recordSafetyFlag,
} from '@/db/queries/interpretations';
import { createReading, getReading, type ReadingView } from '@/db/queries/readings';
import type { CreateReadingInput } from '@/domain/readings/types';
import type { TestUser } from '@/__tests__/rls/harness';
import { fixtureInterpretation } from './reading';

/**
 * Database-backed fixtures for the Phase 05 suites (journal, purge, export, invariants):
 * readings through the real `create_reading()` function as the user, stored interpretations
 * through the write gate, flags and question asks through their query functions — the same
 * paths the product uses, so what the tests delete or export is what a person would have.
 */
export interface JournalRefs {
  rws: DeckRow;
  thoth: DeckRow;
  rwsCards: Awaited<ReturnType<typeof listCards>>;
  thothCards: Awaited<ReturnType<typeof listCards>>;
  spreads: SpreadView[];
  spread: (slug: string) => SpreadView;
  cardId: (deck: 'rws' | 'thoth', slug: string) => string;
}

export async function loadJournalRefs(user: TestUser): Promise<JournalRefs> {
  const rws = (await getDeckBySlug(user.client, 'rws-classic'))!;
  const thoth = (await getDeckBySlug(user.client, 'thoth'))!;
  const rwsCards = await listCards(user.client, rws);
  const thothCards = await listCards(user.client, thoth);
  const spreads = await listSpreads(user.client);
  return {
    rws,
    thoth,
    rwsCards,
    thothCards,
    spreads,
    spread: (slug) => spreads.find((s) => s.slug === slug)!,
    cardId: (deck, slug) => {
      const c = (deck === 'rws' ? rwsCards : thothCards).find((x) => x.slug === slug);
      if (!c) throw new Error(`no ${deck} card ${slug}`);
      return c.id;
    },
  };
}

export interface ReadingSpec {
  deck?: 'rws' | 'thoth';
  spread?: string;
  /** Card slugs in position order; defaults to three sensible cards of the deck. */
  cards?: string[];
  reversed?: number[];
  question?: string | null;
  notes?: string | null;
  lifeArea?: CreateReadingInput['life_area'];
  source?: 'digital' | 'physical';
  occurredAt?: string;
}

export async function makeReading(
  user: TestUser,
  refs: JournalRefs,
  spec: ReadingSpec = {},
): Promise<ReadingView> {
  const deck = spec.deck ?? 'rws';
  const deckRow = deck === 'rws' ? refs.rws : refs.thoth;
  const slugs =
    spec.cards ??
    (deck === 'rws'
      ? ['strength', 'the-tower', 'ace-of-cups']
      : ['lust', 'the-universe', 'princess-of-disks']);
  const spread =
    refs.spread(spec.spread ?? (slugs.length === 1 ? 'one-card' : 'three-card')) ??
    refs.spreads.find((s) => s.card_count === slugs.length)!;
  const usesReversals = deckRow.supports_reversals && (spec.reversed?.length ?? 0) > 0;
  const input: CreateReadingInput = {
    question: spec.question === undefined ? 'Should I take the job?' : spec.question,
    is_open_reflection: spec.question === null,
    life_area: spec.lifeArea ?? null,
    spread_id: spread.id,
    deck_id: deckRow.id,
    source: spec.source ?? 'physical',
    uses_reversals: usesReversals,
    cards: slugs.map((slug, i) => ({
      position_index: i,
      card_id: refs.cardId(deck, slug),
      orientation: spec.reversed?.includes(i) ? 'reversed' : 'upright',
    })),
    user_notes: spec.notes === undefined ? null : spec.notes,
    occurred_at: spec.occurredAt ?? null,
    rng: null,
  };
  const id = await createReading(user.client, input);
  return (await getReading(user.client, id))!;
}

/** A complete, current interpretation for the reading, through the write gate. */
export async function storeInterpretation(user: TestUser, reading: ReadingView) {
  const fixture = fixtureInterpretation(reading);
  const pending = await createPendingInterpretation(user.client, {
    readingId: reading.id,
    userId: user.id,
    metadataVersion: reading.metadata_version,
    depth: 'standard',
    promptVersion: fixture.prompt_version,
    schemaVersion: fixture.schema_version,
  });
  return completeInterpretation(user.client, pending.id, reading.id, {
    output: {
      synthesis: fixture.synthesis,
      per_card: fixture.per_card,
      combined: fixture.combined,
      reflective_prompts: fixture.reflective_prompts,
    },
    modelId: fixture.model_id,
    promptVersion: fixture.prompt_version,
    schemaVersion: fixture.schema_version,
    tokensIn: 100,
    tokensOut: 50,
    costMicros: 0,
    latencyMs: 10,
  });
}

/**
 * Every kind of derived artifact a reading can have today. Phase 06: also a real extraction
 * (mock provider) with its materialised themes, mentions, entities and predictions, plus one
 * user override — when the user is consented and on the extraction flag.
 */
export async function attachDerived(
  user: TestUser,
  reading: ReadingView,
  opts: { memory?: boolean; journey?: boolean } = {},
) {
  const interpretation = await storeInterpretation(user, reading);
  const flag = await recordSafetyFlag(user.client, {
    userId: user.id,
    objectType: 'reading',
    objectId: reading.id,
    category: 'financial',
    severity: 'medium',
    surfaced: true,
  });
  await insertQuestionAsk(user.client, {
    userId: user.id,
    question: reading.question ?? 'open',
    vector: Array.from({ length: 1536 }, (_, i) => (i % 7) / 7),
    model: 'mock-embed',
    nudgeShown: false,
  });
  await linkQuestionAsk(user.client, user.id, reading.question ?? 'open', reading.id);
  let extraction: string | null = null;
  if (opts.memory) {
    const { enableExtraction } = await import('./memory-db');
    const { setAiConsent } = await import('@/db/queries/profile');
    const { runExtraction } = await import('@/memory/extract');
    const { applyCorrection } = await import('@/memory/corrections');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    const out = await runExtraction(reading.id, { force: true });
    if (out.status !== 'complete') throw new Error(`extraction ${out.status}`);
    extraction = out.extractionId;
    await applyCorrection(user.client, user.id, reading.id, { type: 'add_theme', label: 'Trust' });
  }
  // Phase 07: a user-built journey holding the reading (a confirmed member with a
  // progression step once a second member with the same theme exists).
  let journey: string | null = null;
  if (opts.journey) {
    const { createJourney } = await import('@/db/queries/journeys');
    const { refreshJourney } = await import('@/journeys/refresh');
    journey = await createJourney(user.client, user.id, 'Test journey', [reading.id]);
    await refreshJourney(journey);
  }
  return { interpretation, flag, extraction, journey };
}
