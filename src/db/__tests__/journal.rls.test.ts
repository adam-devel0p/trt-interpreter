import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, insertDeletionReceipt } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectReadOwnOnly,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 05 tables and functions. `reading_note_revisions` is written only by a trigger (users
 * read and cascade-delete their own, never insert or update); `deletion_receipts` is read-own,
 * service-role write; `exports` is request-own (queued rows only), read-own, job-written.
 * `search_readings` and the widened `replace_reading_cards` run as the caller.
 */
describe('RLS: reading_note_revisions, deletion_receipts, exports, search_readings', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  let cardIds: string[];
  let spreadId: string;
  let deckId: string;
  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'rws-classic').single();
    const spread = await f.anon.from('spreads').select('id').eq('slug', 'one-card').single();
    deckId = (deck.data as { id: string }).id;
    spreadId = (spread.data as { id: string }).id;
    const cards = await f.anon
      .from('cards')
      .select('id')
      .eq('deck_id', deckId)
      .order('sort_order')
      .limit(3);
    cardIds = (cards.data as { id: string }[]).map((c) => c.id);
    const row = (userId: string, question: string) => ({
      user_id: userId,
      question,
      user_notes: 'original words',
      spread_id: spreadId,
      deck_id: deckId,
      source: 'physical',
      uses_reversals: true,
    });
    const a = await f.a.client
      .from('readings')
      .insert(row(f.a.id, 'A asks about the harvest'))
      .select('id')
      .single();
    const b = await f.b.client
      .from('readings')
      .insert(row(f.b.id, 'B asks about the harvest'))
      .select('id')
      .single();
    readingA = (a.data as { id: string }).id;
    readingB = (b.data as { id: string }).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('reading_note_revisions: trigger-written, owner reads, nobody else; no user insert or update', async () => {
    const upd = await f.a.client
      .from('readings')
      .update({ user_notes: 'new words' })
      .eq('id', readingA);
    expect(upd.error).toBeNull();
    const own = await f.a.client
      .from('reading_note_revisions')
      .select('id, content')
      .eq('reading_id', readingA);
    expect(own.data).toEqual([expect.objectContaining({ content: 'original words' })]);
    const id = (own.data as { id: string }[])[0]!.id;

    const bRead = await f.b.client.from('reading_note_revisions').select('id').eq('id', id);
    expect(bRead.data ?? []).toHaveLength(0);
    const anonRead = await f.anon.from('reading_note_revisions').select('id');
    expect(anonRead.data ?? []).toHaveLength(0);

    const forged = await f.a.client.from('reading_note_revisions').insert({
      reading_id: readingA,
      user_id: f.a.id,
      field: 'user_notes',
      content: 'forged',
      metadata_version: 1,
    });
    expect(forged.error).not.toBeNull();
    const aUpdate = await f.a.client
      .from('reading_note_revisions')
      .update({ content: 'x' })
      .eq('id', id)
      .select('id');
    expect(aUpdate.data ?? []).toHaveLength(0);
    const bDelete = await f.b.client
      .from('reading_note_revisions')
      .delete()
      .eq('id', id)
      .select('id');
    expect(bDelete.data ?? []).toHaveLength(0);
    const still = await f.a.client
      .from('reading_note_revisions')
      .select('content')
      .eq('id', id)
      .single();
    expect(still.data).toEqual({ content: 'original words' });
    // The owner may delete (the purge cascades anyway).
    const aDelete = await f.a.client
      .from('reading_note_revisions')
      .delete()
      .eq('id', id)
      .select('id');
    expect(aDelete.data).toHaveLength(1);
  });

  it('deletion_receipts: read own only; the service role writes', async () => {
    await expectReadOwnOnly(
      f,
      'deletion_receipts',
      (userId) => ({ user_id: userId, scope: 'reading', counts: { readings: 1 } }),
      async (row) =>
        insertDeletionReceipt({
          userId: row.user_id as string,
          scope: 'reading',
          counts: row.counts as Record<string, number>,
        }),
      { mutableColumn: 'scope', mutatedValue: 'account' },
    );
  });

  it('exports: a user requests only their own queued row, reads only their own, updates nothing', async () => {
    const own = await f.a.client
      .from('exports')
      .insert({ user_id: f.a.id })
      .select('id, status')
      .single();
    expect(own.error).toBeNull();
    expect((own.data as { status: string }).status).toBe('queued');
    const id = (own.data as { id: string }).id;

    const spoof = await f.b.client.from('exports').insert({ user_id: f.a.id });
    expect(spoof.error).not.toBeNull();
    const ready = await f.a.client.from('exports').insert({ user_id: f.a.id, status: 'ready' });
    expect(ready.error).not.toBeNull();
    const withPath = await f.a.client
      .from('exports')
      .insert({ user_id: f.a.id, storage_path: `${f.b.id}/x.zip` });
    expect(withPath.error).not.toBeNull();

    const bRead = await f.b.client.from('exports').select('id').eq('id', id);
    expect(bRead.data ?? []).toHaveLength(0);
    expect((await f.anon.from('exports').select('id')).data ?? []).toHaveLength(0);
    const aUpdate = await f.a.client
      .from('exports')
      .update({ status: 'ready', storage_path: 'x' })
      .eq('id', id)
      .select('id');
    expect(aUpdate.data ?? []).toHaveLength(0);
    const aDelete = await f.a.client.from('exports').delete().eq('id', id).select('id');
    expect(aDelete.data ?? []).toHaveLength(0);
    const still = await f.a.client.from('exports').select('status').eq('id', id).single();
    expect(still.data).toEqual({ status: 'queued' });
  });

  it('search_readings returns only the caller’s readings; anon gets nothing', async () => {
    const a = await f.a.client.rpc('search_readings', { p: { q: 'harvest' } }).select('id');
    expect((a.data as { id: string }[]).map((r) => r.id)).toEqual([readingA]);
    const b = await f.b.client.rpc('search_readings', { p: {} }).select('id');
    expect((b.data as { id: string }[]).map((r) => r.id)).toEqual([readingB]);
    const anon = await f.anon.rpc('search_readings', { p: {} }).select('id');
    expect(anon.data ?? []).toHaveLength(0);
  });

  it('replace_reading_cards with a deck/spread change refuses another user’s reading', async () => {
    const asB = await f.b.client.rpc('replace_reading_cards', {
      p_reading_id: readingA,
      p_cards: [{ position_index: 0, card_id: cardIds[0], orientation: 'upright' }],
      p_spread_id: spreadId,
      p_deck_id: deckId,
      p_uses_reversals: false,
    });
    expect(asB.error?.code).toBe('P0002');
    const asAnon = await f.anon.rpc('replace_reading_cards', {
      p_reading_id: readingA,
      p_cards: [],
    });
    expect(asAnon.error).not.toBeNull();
  });
});
