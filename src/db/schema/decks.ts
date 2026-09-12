import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { anonRole, authenticatedRole, authUid, authUsers } from 'drizzle-orm/supabase';
import { aliasKind, arcana, artStrategy, deckSystem } from './enums';

/**
 * Deck reference layer (docs/DATA_MODEL.md#deck-reference-layer--phase-02).
 *
 * Global data: readable by `authenticated` and `anon` (public reference pages), writable only
 * by the service role (the seeder). RWS and Thoth are both first-class: every card row is
 * deck-native — name, court structure, titles, meanings and correspondences belong to the deck
 * that printed them (§6.7, invariant 3).
 */

/** Read-for-everyone policy shared by the reference tables. */
const publicRead = (name: string) =>
  pgPolicy(name, { for: 'select', to: [anonRole, authenticatedRole], using: sql`true` });

export const decks = pgTable(
  'decks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    system: deckSystem('system').notNull(),
    /** Short description of the deck's interpretive tradition, shown on reference pages. */
    traditionNotes: text('tradition_notes').notNull(),
    /**
     * Whether readings with this deck may mark cards reversed. Thoth practice reads by dignity
     * and position rather than reversal, so its rows carry null reversed meanings.
     */
    supportsReversals: boolean('supports_reversals').notNull().default(true),
    artStrategy: artStrategy('art_strategy').notNull(),
    /** Provenance of anything bundled, or why nothing is (§6.7 artwork rights). */
    licenseNote: text('license_note').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [publicRead('decks_select')],
).enableRLS();

export type Deck = typeof decks.$inferSelect;

export const cards = pgTable(
  'cards',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    /** Deck-native display name: RWS "Strength", Thoth "Lust". Never resolved via archetypes. */
    name: text('name').notNull(),
    /** Deck-native card title where the tradition uses one (Thoth small cards: "Dominion"). */
    title: text('title'),
    arcana: arcana('arcana').notNull(),
    /** Machine key: wands | cups | swords | pentacles | disks. Null for Majors. */
    suit: text('suit'),
    /** Display suit name in the deck's own vocabulary ("Disks", not "Pentacles"). */
    suitLabel: text('suit_label'),
    /** Deck-native court term: RWS Page/Knight/Queen/King · Thoth Princess/Prince/Queen/Knight. */
    rankLabel: text('rank_label'),
    /** Printed number: Majors 0–21, pips 1–10; null for court cards. */
    number: smallint('number'),
    /** Roman numeral as printed on the card, for Majors. */
    numeral: text('numeral'),
    element: text('element'),
    astrology: text('astrology'),
    keywordsUpright: text('keywords_upright').array().notNull(),
    keywordsReversed: text('keywords_reversed').array().notNull(),
    meaningUpright: text('meaning_upright').notNull(),
    /** Null where the deck does not read reversals (Thoth). The UI must handle null. */
    meaningReversed: text('meaning_reversed'),
    symbolism: text('symbolism').notNull(),
    /** Typed bag (domain/decks/correspondences.ts): sephira, path, hebrew letter, decan … */
    correspondences: jsonb('correspondences')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Public path prefix of bundled art (renderer prefers art when present); null = typographic. */
    artAssetPath: text('art_asset_path'),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [
    uniqueIndex('cards_deck_slug_idx').on(t.deckId, t.slug),
    index('cards_deck_sort_idx').on(t.deckId, t.sortOrder),
    publicRead('cards_select'),
  ],
).enableRLS();

export type CardRow = typeof cards.$inferSelect;

/**
 * Structural slots shared across decks (78 of them). METADATA ONLY: used for search, analytics
 * and cross-deck aggregation. Render paths resolve names and meanings through `cards`, never
 * through this table (§6.7; invariant test thoth-never-substitutes-rws).
 */
export const cardArchetypes = pgTable(
  'card_archetypes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    key: text('key').notNull().unique(),
    /** Neutral structural label ("Major VIII", "Two of the earth suit"), never a card name. */
    label: text('label').notNull(),
    arcana: arcana('arcana').notNull(),
    /** Structural suit slot: fire | water | air | earth. Null for Majors. */
    suitSlot: text('suit_slot'),
    /** Structural rank slot: 1–10, or court_1..court_4 (lowest to highest). */
    rankSlot: text('rank_slot'),
    number: smallint('number'),
    sortOrder: smallint('sort_order').notNull(),
  },
  () => [publicRead('card_archetypes_select')],
).enableRLS();

export const cardArchetypeMembers = pgTable(
  'card_archetype_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    archetypeId: uuid('archetype_id')
      .notNull()
      .references(() => cardArchetypes.id, { onDelete: 'cascade' }),
    /** Unique: a card belongs to exactly one structural slot. */
    cardId: uuid('card_id')
      .notNull()
      .unique()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** Why the correspondence is structural, not interpretive (Adjustment↔Justice …). */
    mappingNote: text('mapping_note'),
  },
  (t) => [
    index('card_archetype_members_archetype_idx').on(t.archetypeId),
    publicRead('card_archetype_members_select'),
  ],
).enableRLS();

/** Search aliases (FR-03C). A hit is always labeled with the card's actual deck and name. */
export const cardAliases = pgTable(
  'card_aliases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    kind: aliasKind('kind').notNull(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('card_aliases_card_alias_idx').on(t.cardId, t.alias),
    publicRead('card_aliases_select'),
  ],
).enableRLS();

/**
 * Spreads. Built-in rows have `user_id` null and are readable by everyone; custom spreads
 * (creation UI in a later phase) are owned rows with the standard four policies.
 */
export const spreads = pgTable(
  'spreads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    /** [{ index, key, name, prompt }] — prompt grounds per-position interpretation (§6.2). */
    positions: jsonb('positions').notNull(),
    /** { aspect, slots: [{ index, x, y, w, rotate? }] } in relative units (domain/decks/spreads.ts). */
    layout: jsonb('layout').notNull(),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    deckScope: deckSystem('deck_scope'),
    cardCount: smallint('card_count').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('spreads_builtin_slug_idx')
      .on(t.slug)
      .where(sql`${t.userId} is null`),
    uniqueIndex('spreads_user_slug_idx')
      .on(t.userId, t.slug)
      .where(sql`${t.userId} is not null`),
    pgPolicy('spreads_select', {
      for: 'select',
      to: [anonRole, authenticatedRole],
      using: sql`${t.userId} is null or ${t.userId} = ${authUid}`,
    }),
    pgPolicy('spreads_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid} and ${t.isBuiltin} = false`,
    }),
    pgPolicy('spreads_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid} and ${t.isBuiltin} = false`,
    }),
    pgPolicy('spreads_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export type SpreadRow = typeof spreads.$inferSelect;
