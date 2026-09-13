import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Readings are the first journal content. B must not read, update or delete A's readings or
 * cards, must not insert a card against A's reading (even with their own user_id), and must not
 * call the transactional RPC on A's behalf. Custom spreads keep their Phase 02 isolation.
 */
describe('RLS: readings, reading_cards, reading_drafts', () => {
  let f: RlsFixture;
  let deckId: string;
  let cardIds: string[];
  let spreadId: string;
  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'rws-classic').single();
    deckId = (deck.data as { id: string }).id;
    const cards = await f.anon
      .from('cards')
      .select('id')
      .eq('deck_id', deckId)
      .order('sort_order')
      .limit(6);
    cardIds = (cards.data as { id: string }[]).map((c) => c.id);
    const spread = await f.anon.from('spreads').select('id').eq('slug', 'one-card').single();
    spreadId = (spread.data as { id: string }).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  const readingRow = (userId: string) => ({
    user_id: userId,
    question: 'Is this mine?',
    spread_id: spreadId,
    deck_id: deckId,
    source: 'physical',
    uses_reversals: true,
  });

  it('readings: standard four-policy isolation', async () => {
    await expectRlsIsolation(f, 'readings', readingRow, {
      mutableColumn: 'question',
      mutatedValue: 'Hijacked',
    });
  });

  it('reading_cards: isolated, and B cannot attach a card to A’s reading even with their own user_id', async () => {
    const ins = await f.a.client.from('readings').insert(readingRow(f.a.id)).select('id').single();
    expect(ins.error).toBeNull();
    const readingId = (ins.data as { id: string }).id;

    await expectRlsIsolation(
      f,
      'reading_cards',
      (userId) => ({
        reading_id: readingId,
        user_id: userId,
        position_index: 0,
        position_key: 'the_card',
        card_id: cardIds[0],
        orientation: 'upright',
        sort_order: 0,
      }),
      { mutableColumn: 'orientation', mutatedValue: 'reversed' },
    );

    // B claims their own user_id but A's reading: the parent-exists half of the policy refuses.
    const spoof = await f.b.client.from('reading_cards').insert({
      reading_id: readingId,
      user_id: f.b.id,
      position_index: 0,
      position_key: 'the_card',
      card_id: cardIds[1],
      sort_order: 0,
    });
    expect(spoof.error).not.toBeNull();
    const seenByA = await f.a.client.from('reading_cards').select('id').eq('reading_id', readingId);
    expect(seenByA.data).toHaveLength(0);

    // B cannot re-point their own card row at A's reading either.
    const bReading = await f.b.client
      .from('readings')
      .insert(readingRow(f.b.id))
      .select('id')
      .single();
    const bReadingId = (bReading.data as { id: string }).id;
    const bCard = await f.b.client
      .from('reading_cards')
      .insert({
        reading_id: bReadingId,
        user_id: f.b.id,
        position_index: 0,
        position_key: 'the_card',
        card_id: cardIds[2],
        sort_order: 0,
      })
      .select('id')
      .single();
    expect(bCard.error).toBeNull();
    const repoint = await f.b.client
      .from('reading_cards')
      .update({ reading_id: readingId })
      .eq('id', (bCard.data as { id: string }).id)
      .select('id');
    expect(repoint.error ?? repoint.data?.length === 0).toBeTruthy();

    // The transactional RPC runs as the caller: B's call creates B's reading, never A's.
    const rpc = await f.b.client.rpc('create_reading', {
      p: {
        ...readingRow(f.a.id),
        cards: [{ position_index: 0, card_id: cardIds[3], orientation: 'upright' }],
      },
    });
    expect(rpc.error).toBeNull();
    const created = await f.b.client
      .from('readings')
      .select('user_id')
      .eq('id', rpc.data as string)
      .single();
    expect(created.data).toEqual({ user_id: f.b.id });
    const aSees = await f.a.client
      .from('readings')
      .select('id')
      .eq('id', rpc.data as string);
    expect(aSees.data).toHaveLength(0);

    // Anon cannot call it at all.
    const anonRpc = await f.anon.rpc('create_reading', {
      p: { ...readingRow(f.a.id), cards: [] },
    });
    expect(anonRpc.error).not.toBeNull();

    // B cannot replace A's cards through the RPC.
    const replace = await f.b.client.rpc('replace_reading_cards', {
      p_reading_id: readingId,
      p_cards: [{ position_index: 0, card_id: cardIds[4], orientation: 'upright' }],
    });
    expect(replace.error?.code).toBe('P0002');
  });

  it('reading_drafts: one per user, isolated', async () => {
    await expectRlsIsolation(
      f,
      'reading_drafts',
      (userId) => ({ user_id: userId, payload: { version: 1, step: 'question' } }),
      {
        mutableColumn: 'payload',
        mutatedValue: { version: 1, step: 'hijacked' },
        idColumn: 'user_id',
      },
    );
  });
});
