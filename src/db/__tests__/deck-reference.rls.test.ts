import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectPublicReadOnly,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Reference tables are the opposite of the isolation harness: everyone (anon included, for the
 * public pages) can read; only the service role writes. `spreads` is mixed: built-in rows are
 * public, custom rows are user-owned with the standard four policies.
 */
describe('RLS: deck reference layer (public read, service-role write)', () => {
  let f: RlsFixture;
  let deckId: string;
  let cardId: string;
  let archetypeId: string;
  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'thoth').single();
    deckId = (deck.data as { id: string }).id;
    const card = await f.anon
      .from('cards')
      .select('id')
      .eq('deck_id', deckId)
      .eq('slug', 'lust')
      .single();
    cardId = (card.data as { id: string }).id;
    const arch = await f.anon.from('card_archetypes').select('id').limit(1).single();
    archetypeId = (arch.data as { id: string }).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('decks', async () => {
    await expectPublicReadOnly(
      f,
      'decks',
      {
        slug: 'rls-probe',
        name: 'Probe',
        system: 'rws',
        tradition_notes: 'x',
        art_strategy: 'text_only',
        license_note: 'x',
      },
      { mutableColumn: 'name', mutatedValue: 'Renamed' },
    );
  });

  it('cards — and the row anon reads is the deck-native one', async () => {
    await expectPublicReadOnly(
      f,
      'cards',
      {
        deck_id: deckId,
        slug: 'rls-probe',
        name: 'Probe',
        arcana: 'major',
        keywords_upright: ['x'],
        keywords_reversed: [],
        meaning_upright: 'x',
        symbolism: 'x',
        sort_order: 99,
      },
      { mutableColumn: 'name', mutatedValue: 'Strength' },
    );
    const lust = await f.anon
      .from('cards')
      .select('name, meaning_reversed')
      .eq('id', cardId)
      .single();
    expect(lust.data).toEqual({ name: 'Lust', meaning_reversed: null });
  });

  it('card_archetypes and card_archetype_members', async () => {
    await expectPublicReadOnly(
      f,
      'card_archetypes',
      { key: 'rls.probe', label: 'Probe', arcana: 'major', sort_order: 99 },
      { mutableColumn: 'label', mutatedValue: 'Renamed' },
    );
    await expectPublicReadOnly(
      f,
      'card_archetype_members',
      { archetype_id: archetypeId, card_id: cardId },
      { mutableColumn: 'mapping_note', mutatedValue: 'tampered' },
    );
  });

  it('card_aliases', async () => {
    await expectPublicReadOnly(
      f,
      'card_aliases',
      { card_id: cardId, alias: 'Probe', kind: 'search' },
      { mutableColumn: 'alias', mutatedValue: 'Tampered' },
    );
  });

  it('spreads: built-ins are public and immutable; custom spreads are isolated per user', async () => {
    // Built-in rows: readable by anon, not writable by anyone but the service role.
    await expectPublicReadOnly(
      f,
      'spreads',
      {
        slug: 'rls-builtin-probe',
        name: 'Probe',
        description: 'x',
        positions: [],
        layout: { aspect: 1, slots: [] },
        is_builtin: true,
        card_count: 0,
      },
      { mutableColumn: 'name', mutatedValue: 'Renamed' },
    );
    const anonRows = await f.anon.from('spreads').select('user_id, is_builtin');
    expect(anonRows.data?.every((r) => r.user_id === null && r.is_builtin === true)).toBe(true);

    // A user may not create a built-in even with their own user_id.
    const fakeBuiltin = await f.a.client.from('spreads').insert({
      user_id: f.a.id,
      slug: 'sneaky',
      name: 'Sneaky',
      description: 'x',
      positions: [],
      layout: { aspect: 1, slots: [] },
      is_builtin: true,
      card_count: 0,
    });
    expect(fakeBuiltin.error).not.toBeNull();

    // Custom spreads: the standard four policies, keyed on user_id.
    await expectRlsIsolation(
      f,
      'spreads',
      (userId) => ({
        user_id: userId,
        slug: 'my-spread',
        name: 'My spread',
        description: 'Two cards.',
        positions: [
          { index: 0, key: 'a', name: 'A', prompt: 'What is happening here right now.' },
          { index: 1, key: 'b', name: 'B', prompt: 'What might help with it.' },
        ],
        layout: {
          aspect: 2,
          slots: [
            { index: 0, x: 0.3, y: 0.5, w: 0.3 },
            { index: 1, x: 0.7, y: 0.5, w: 0.3 },
          ],
        },
        card_count: 2,
      }),
      { mutableColumn: 'name', mutatedValue: 'Hijacked', hasPublicRows: true },
    );
  });
});
