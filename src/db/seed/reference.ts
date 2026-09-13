import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import {
  cardAliases,
  cardArchetypeMembers,
  cardArchetypes,
  cards,
  decks,
  spreads,
  themes,
} from '@/db/schema';
import type { DeckSeed, DeckSystem } from '@/domain/decks/types';
import { CURATED_THEMES } from '@/domain/themes/taxonomy';
import { ALIASES } from './decks/aliases';
import { ARCHETYPES, archetypeKeyFor, mappingNoteFor } from './decks/archetypes';
import { RWS_DECK } from './decks/rws';
import { SPREADS } from './decks/spreads';
import { THOTH_DECK } from './decks/thoth';

export const DECK_SEEDS: readonly DeckSeed[] = [RWS_DECK, THOTH_DECK];

export interface SeedSummary {
  decks: number;
  cards: number;
  archetypes: number;
  members: number;
  aliases: number;
  spreads: number;
  themes: number;
}

/**
 * Upserts every reference row keyed by its natural slug/key, so running it twice changes
 * nothing (IDs are stable; `pnpm db:seed` is safe on a populated database). Aliases and
 * members that are no longer in the seed set are removed, so the database mirrors the files.
 */
export async function seedReferenceData(): Promise<SeedSummary> {
  const db = platformDb();
  const summary: SeedSummary = {
    decks: 0,
    cards: 0,
    archetypes: 0,
    members: 0,
    aliases: 0,
    spreads: 0,
    themes: 0,
  };

  // Archetypes first: they do not depend on decks.
  const archetypeRows = await db
    .insert(cardArchetypes)
    .values(
      ARCHETYPES.map((a) => ({
        key: a.key,
        label: a.label,
        arcana: a.arcana,
        suitSlot: a.suit_slot,
        rankSlot: a.rank_slot,
        number: a.number,
        sortOrder: a.sort_order,
      })),
    )
    .onConflictDoUpdate({
      target: cardArchetypes.key,
      set: {
        label: sql`excluded.label`,
        arcana: sql`excluded.arcana`,
        suitSlot: sql`excluded.suit_slot`,
        rankSlot: sql`excluded.rank_slot`,
        number: sql`excluded.number`,
        sortOrder: sql`excluded.sort_order`,
      },
    })
    .returning({ id: cardArchetypes.id, key: cardArchetypes.key });
  summary.archetypes = archetypeRows.length;
  const archetypeId = new Map(archetypeRows.map((r) => [r.key, r.id]));

  const cardIdBySlug = new Map<string, string>(); // `${system}/${slug}` → id

  for (const deck of DECK_SEEDS) {
    const [deckRow] = await db
      .insert(decks)
      .values({
        slug: deck.slug,
        name: deck.name,
        system: deck.system,
        traditionNotes: deck.tradition_notes,
        supportsReversals: deck.supports_reversals,
        artStrategy: deck.art_strategy,
        licenseNote: deck.license_note,
        sortOrder: deck.sort_order,
      })
      .onConflictDoUpdate({
        target: decks.slug,
        set: {
          name: sql`excluded.name`,
          system: sql`excluded.system`,
          traditionNotes: sql`excluded.tradition_notes`,
          supportsReversals: sql`excluded.supports_reversals`,
          artStrategy: sql`excluded.art_strategy`,
          licenseNote: sql`excluded.license_note`,
          sortOrder: sql`excluded.sort_order`,
        },
      })
      .returning({ id: decks.id });
    if (!deckRow) throw new Error(`deck upsert returned nothing for ${deck.slug}`);
    summary.decks += 1;

    const cardRows = await db
      .insert(cards)
      .values(
        deck.cards.map((c) => ({
          deckId: deckRow.id,
          slug: c.slug,
          name: c.name,
          title: c.title,
          arcana: c.arcana,
          suit: c.suit,
          suitLabel: c.suit_label,
          rankLabel: c.rank_label,
          number: c.number,
          numeral: c.numeral,
          element: c.element,
          astrology: c.astrology,
          keywordsUpright: c.keywords_upright,
          keywordsReversed: c.keywords_reversed,
          meaningUpright: c.meaning_upright,
          meaningReversed: c.meaning_reversed,
          symbolism: c.symbolism,
          correspondences: c.correspondences,
          artAssetPath: c.art_asset_path,
          sortOrder: c.sort_order,
        })),
      )
      .onConflictDoUpdate({
        target: [cards.deckId, cards.slug],
        set: {
          name: sql`excluded.name`,
          title: sql`excluded.title`,
          arcana: sql`excluded.arcana`,
          suit: sql`excluded.suit`,
          suitLabel: sql`excluded.suit_label`,
          rankLabel: sql`excluded.rank_label`,
          number: sql`excluded.number`,
          numeral: sql`excluded.numeral`,
          element: sql`excluded.element`,
          astrology: sql`excluded.astrology`,
          keywordsUpright: sql`excluded.keywords_upright`,
          keywordsReversed: sql`excluded.keywords_reversed`,
          meaningUpright: sql`excluded.meaning_upright`,
          meaningReversed: sql`excluded.meaning_reversed`,
          symbolism: sql`excluded.symbolism`,
          correspondences: sql`excluded.correspondences`,
          artAssetPath: sql`excluded.art_asset_path`,
          sortOrder: sql`excluded.sort_order`,
        },
      })
      .returning({ id: cards.id, slug: cards.slug });
    summary.cards += cardRows.length;
    for (const r of cardRows) cardIdBySlug.set(`${deck.system}/${r.slug}`, r.id);

    // Remove cards that left the seed set (never expected; keeps the mirror exact).
    await db.delete(cards).where(
      and(
        eq(cards.deckId, deckRow.id),
        notInArray(
          cards.slug,
          deck.cards.map((c) => c.slug),
        ),
      ),
    );

    // Archetype membership — metadata only (see card_archetypes comment).
    const memberRows = await db
      .insert(cardArchetypeMembers)
      .values(
        deck.cards.map((c) => {
          const key = archetypeKeyFor(deck.system, c);
          const aid = archetypeId.get(key);
          if (!aid) throw new Error(`no archetype for ${key}`);
          return {
            archetypeId: aid,
            cardId: cardIdBySlug.get(`${deck.system}/${c.slug}`)!,
            mappingNote: mappingNoteFor(deck.system, c),
          };
        }),
      )
      .onConflictDoUpdate({
        target: cardArchetypeMembers.cardId,
        set: {
          archetypeId: sql`excluded.archetype_id`,
          mappingNote: sql`excluded.mapping_note`,
        },
      })
      .returning({ id: cardArchetypeMembers.id });
    summary.members += memberRows.length;
  }

  // Aliases: upsert the set, then delete any alias on a seeded card that is not in the set.
  const aliasValues = ALIASES.map((al) => {
    const cardId = cardIdBySlug.get(`${al.deck}/${al.card_slug}`);
    if (!cardId) throw new Error(`alias points at unknown card ${al.deck}/${al.card_slug}`);
    return { cardId, alias: al.alias, kind: al.kind, note: al.note };
  });
  const aliasRows = await db
    .insert(cardAliases)
    .values(aliasValues)
    .onConflictDoUpdate({
      target: [cardAliases.cardId, cardAliases.alias],
      set: { kind: sql`excluded.kind`, note: sql`excluded.note` },
    })
    .returning({ id: cardAliases.id });
  summary.aliases = aliasRows.length;
  const seededCardIds = [...cardIdBySlug.values()];
  await db.delete(cardAliases).where(
    and(
      inArray(cardAliases.cardId, seededCardIds),
      notInArray(
        cardAliases.id,
        aliasRows.map((r) => r.id),
      ),
    ),
  );

  // Built-in spreads (user_id null); custom spreads are untouched.
  for (const s of SPREADS) {
    await db
      .insert(spreads)
      .values({
        userId: null,
        slug: s.slug,
        name: s.name,
        description: s.description,
        positions: s.positions,
        layout: s.layout,
        isBuiltin: true,
        deckScope: s.deck_scope,
        cardCount: s.positions.length,
        sortOrder: s.sort_order,
      })
      .onConflictDoUpdate({
        target: spreads.slug,
        targetWhere: isNull(spreads.userId),
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          positions: sql`excluded.positions`,
          layout: sql`excluded.layout`,
          isBuiltin: sql`true`,
          deckScope: sql`excluded.deck_scope`,
          cardCount: sql`excluded.card_count`,
          sortOrder: sql`excluded.sort_order`,
        },
      });
    summary.spreads += 1;
  }

  // Phase 06: the curated theme taxonomy (global rows, user_id null). Labels may change;
  // slugs are the stable keys the model's proposals resolve onto.
  for (const t of CURATED_THEMES) {
    await db
      .insert(themes)
      .values({ userId: null, slug: t.slug, label: t.label, category: t.category })
      .onConflictDoUpdate({
        target: [themes.userId, themes.slug],
        set: { label: sql`excluded.label`, category: sql`excluded.category` },
      });
    summary.themes += 1;
  }

  return summary;
}

/** Resolve a deck's id by system (used by tests and later seeders). */
export async function deckIdBySystem(system: DeckSystem): Promise<string> {
  const row = await platformDb().query.decks.findFirst({ where: eq(decks.system, system) });
  if (!row) throw new Error(`deck ${system} not seeded`);
  return row.id;
}
