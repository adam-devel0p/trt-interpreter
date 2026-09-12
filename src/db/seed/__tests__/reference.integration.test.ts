import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformSql } from '@/db/admin';
import { createAnonClient } from '@/db/client';
import {
  getCardBySlug,
  getDeckBySlug,
  listCards,
  listDecks,
  listSpreads,
  neighbourCards,
} from '@/db/queries/decks';
import { getProfile, updateProfile } from '@/db/queries/profile';
import { searchCards } from '@/domain/decks/search';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import { seedReferenceData } from '../reference';

interface Snapshot {
  counts: Record<string, number>;
  digest: string;
}

/** Content + ids of every reference row, order-independent. Equal snapshots ⇒ nothing changed. */
async function snapshot(): Promise<Snapshot> {
  const sql = platformSql();
  const tables = ['decks', 'cards', 'card_archetypes', 'card_archetype_members', 'card_aliases'];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`);
    counts[t] = r[0]!.n;
  }
  const b = await sql`select count(*)::int as n from spreads where user_id is null`;
  counts.builtin_spreads = b[0]!.n;
  const digest = await sql`
    select md5(string_agg(row_text, '|' order by row_text)) as d from (
      select d.id::text || d.slug || d.name || d.tradition_notes || d.license_note as row_text from decks d
      union all
      select c.id::text || c.deck_id::text || c.slug || c.name || coalesce(c.title,'') || c.meaning_upright
             || coalesce(c.meaning_reversed,'') || c.symbolism || c.correspondences::text || c.sort_order::text from cards c
      union all
      select a.id::text || a.key || a.label from card_archetypes a
      union all
      select m.id::text || m.archetype_id::text || m.card_id::text || coalesce(m.mapping_note,'') from card_archetype_members m
      union all
      select al.id::text || al.card_id::text || al.alias || al.kind::text from card_aliases al
      union all
      select s.id::text || s.slug || s.name || s.positions::text || s.layout::text from spreads s where s.user_id is null
    ) x`;
  return { counts, digest: digest[0]!.d as string };
}

describe('reference seed against the database', () => {
  let user: TestUser;
  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('deckref');
  });
  afterAll(async () => {
    await deleteTestUser(user);
  });

  it('seeds 2 decks × 78 cards, 78 archetypes, 156 members, aliases and 5 built-in spreads', async () => {
    const s = await snapshot();
    expect(s.counts).toMatchObject({
      decks: 2,
      cards: 156,
      card_archetypes: 78,
      card_archetype_members: 156,
      builtin_spreads: 5,
    });
    expect(s.counts.card_aliases).toBeGreaterThan(100);
  });

  it('is idempotent: running the seeder again changes nothing, not even ids', async () => {
    const before = await snapshot();
    const summary = await seedReferenceData();
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(summary).toMatchObject({
      decks: 2,
      cards: 156,
      archetypes: 78,
      members: 156,
      spreads: 5,
    });
  });

  it('anon reads both decks through the query layer, deck-natively', async () => {
    const anon = createAnonClient();
    const decks = await listDecks(anon);
    expect(decks.map((d) => d.slug)).toEqual(['rws-classic', 'thoth']);
    const thoth = (await getDeckBySlug(anon, 'thoth'))!;
    const cards = await listCards(anon, thoth);
    expect(cards).toHaveLength(78);
    expect(cards.filter((c) => c.suit === 'disks')).toHaveLength(14);
    expect(cards.some((c) => c.rank_label === 'Page')).toBe(false);

    const lust = (await getCardBySlug(anon, thoth, 'lust'))!;
    expect(lust.name).toBe('Lust');
    expect(lust.deck_name).toBe('Thoth');
    expect(lust.meaning_reversed).toBeNull();
    expect(lust.deck_supports_reversals).toBe(false);
    expect(lust.aliases.map((a) => a.alias)).toContain('Strength');
    expect(lust.correspondences.hebrew_letter).toBe('Teth');

    const n = await neighbourCards(anon, thoth, lust.sort_order);
    expect(n.prev?.name).toBe('Fortune');
    expect(n.next?.name).toBe('The Hanged Man');

    const spreads = await listSpreads(anon);
    expect(spreads.map((s) => s.slug)).toContain('celtic-cross-lite');
  });

  it('database-backed search: "Strength" in Thoth → Lust (labeled Lust), "Pentacles" → Disks', async () => {
    const anon = createAnonClient();
    const thoth = (await getDeckBySlug(anon, 'thoth'))!;
    const cards = await listCards(anon, thoth);
    const hits = searchCards(cards, 'Strength');
    const lust = hits.find((h) => h.matched === 'alias')!;
    expect(lust.card.name).toBe('Lust');
    expect(lust.card.deck_name).toBe('Thoth');
    expect(lust.via).toBe('Strength');
    const disks = searchCards(cards, 'Pentacles', { limit: 20 });
    expect(disks.length).toBeGreaterThan(0);
    expect(disks.every((h) => h.card.suit_label === 'Disks')).toBe(true);
  });

  it('profiles.default_deck_id is a real FK: a deck id sticks, a random uuid is rejected', async () => {
    const anon = createAnonClient();
    const thoth = (await getDeckBySlug(anon, 'thoth'))!;
    const updated = await updateProfile(user.client, user.id, {
      default_deck_id: thoth.id,
      use_reversals: false,
    });
    expect(updated.default_deck_id).toBe(thoth.id);
    expect(updated.use_reversals).toBe(false);
    await expect(
      updateProfile(user.client, user.id, {
        default_deck_id: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow();
    expect((await getProfile(user.client, user.id))!.default_deck_id).toBe(thoth.id);
  });
});
