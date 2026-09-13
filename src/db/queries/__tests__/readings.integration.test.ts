import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import {
  getDeckBySlug,
  listCards,
  listSpreads,
  type DeckRow,
  type SpreadView,
} from '@/db/queries/decks';
import {
  createReading,
  softDeleteReading,
  deleteServerDraft,
  getReading,
  getServerDraft,
  listReadings,
  listRecentCardIds,
  replaceReadingCards,
  setFollowUpStatus,
  setRevisitAt,
  updateReading,
  updateReadingNotes,
  upsertServerDraft,
} from '@/db/queries/readings';
import { createCustomSpread, deleteCustomSpread, listCustomSpreads } from '@/db/queries/spreads';
import { seedReferenceData } from '@/db/seed/reference';
import { newDraft, placeCard, setSpread } from '@/domain/readings/draft';
import { drawCards, replayDraw } from '@/domain/readings/draw';
import type { CreateReadingInput } from '@/domain/readings/types';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * The reading loop against the real database: transactional create through `create_reading()`,
 * the deck/reversal triggers, back-dating, custom spreads, revisit and follow-up writes, notes,
 * cards replacement, cascade delete and the server-side draft.
 */
describe('readings query layer (integration)', () => {
  let user: TestUser;
  let rws: DeckRow;
  let thoth: DeckRow;
  let rwsIds: string[];
  let thothIds: string[];
  let spreads: SpreadView[];
  const spread = (slug: string) => spreads.find((s) => s.slug === slug)!;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('readings');
    rws = (await getDeckBySlug(user.client, 'rws-classic'))!;
    thoth = (await getDeckBySlug(user.client, 'thoth'))!;
    rwsIds = (await listCards(user.client, rws)).map((c) => c.id);
    thothIds = (await listCards(user.client, thoth)).map((c) => c.id);
    spreads = await listSpreads(user.client);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  function physical(over: Partial<CreateReadingInput> = {}): CreateReadingInput {
    return {
      question: 'Should I take the job?',
      is_open_reflection: false,
      life_area: 'work',
      spread_id: spread('three-card').id,
      deck_id: rws.id,
      source: 'physical',
      uses_reversals: true,
      cards: [
        { position_index: 0, card_id: rwsIds[0]!, orientation: 'upright' },
        { position_index: 1, card_id: rwsIds[1]!, orientation: 'reversed' },
        { position_index: 2, card_id: rwsIds[2]!, orientation: 'upright' },
      ],
      user_notes: 'The Fool again.',
      occurred_at: null,
      rng: null,
      ...over,
    };
  }

  it('creates a physical three-card RWS reading and reopens it with deck-native cards in position', async () => {
    const id = await createReading(user.client, physical());
    const r = (await getReading(user.client, id))!;
    expect(r.user_id).toBe(user.id);
    expect(r.question).toBe('Should I take the job?');
    expect(r.life_area).toBe('work');
    expect(r.source).toBe('physical');
    expect(r.rng).toBeNull();
    expect(r.deck.slug).toBe('rws-classic');
    expect(r.spread.slug).toBe('three-card');
    expect(r.follow_up_status).toBe('unresolved');
    expect(r.user_notes).toBe('The Fool again.');
    expect(r.cards.map((c) => c.position_key)).toEqual(['past', 'present', 'future']);
    expect(r.cards.map((c) => c.orientation)).toEqual(['upright', 'reversed', 'upright']);
    expect(r.cards[0]!.card.name).toBe('The Fool');
    expect(r.cards[0]!.card.deck_name).toBe('Rider–Waite–Smith');
    expect(r.cards[0]!.card.meaning_upright.length).toBeGreaterThan(100);
    expect(r.cards[1]!.card.meaning_reversed).not.toBeNull();
    expect(r.cards[2]!.position?.name).toBe('Future');
    expect(r.cards[2]!.position?.prompt.length).toBeGreaterThan(20);
    // occurred_at defaulted to now (within a minute).
    expect(Date.now() - new Date(r.occurred_at).getTime()).toBeLessThan(60_000);
  });

  it('creates a digital reading from a server-side draw whose rng record replays to the same cards', async () => {
    const seed = randomBytes(16).toString('hex');
    const draw = drawCards({
      cardIds: rwsIds,
      deckId: rws.id,
      count: 3,
      usesReversals: true,
      seed,
    });
    const id = await createReading(
      user.client,
      physical({ source: 'digital', cards: draw.cards, rng: draw.rng, user_notes: null }),
    );
    const r = (await getReading(user.client, id))!;
    expect(r.rng).toEqual(draw.rng);
    expect(
      r.cards.map((c) => ({
        position_index: c.position_index,
        card_id: c.card.id,
        orientation: c.orientation,
      })),
    ).toEqual(draw.cards);
    expect(replayDraw(r.rng!, rwsIds, 3)).toEqual(draw.cards);
    expect(r.user_notes).toBeNull();
  });

  it('a Thoth reading never uses reversals, and a reversed Thoth card is rejected at the database', async () => {
    const id = await createReading(
      user.client,
      physical({
        deck_id: thoth.id,
        uses_reversals: false,
        cards: [
          { position_index: 0, card_id: thothIds[0]!, orientation: 'upright' },
          { position_index: 1, card_id: thothIds[1]!, orientation: 'upright' },
          { position_index: 2, card_id: thothIds[2]!, orientation: 'upright' },
        ],
      }),
    );
    const r = (await getReading(user.client, id))!;
    expect(r.deck.slug).toBe('thoth');
    expect(r.uses_reversals).toBe(false);
    expect(r.cards[0]!.card.name).toBe('The Fool');
    expect(r.cards.every((c) => c.card.meaning_reversed === null)).toBe(true);

    // Zod refuses before the network; bypass it to prove the trigger refuses too.
    const rpc = await user.client.rpc('create_reading', {
      p: {
        ...physical({ deck_id: thoth.id, uses_reversals: true }),
        cards: [
          { position_index: 0, card_id: thothIds[3], orientation: 'reversed' },
          { position_index: 1, card_id: thothIds[4], orientation: 'upright' },
          { position_index: 2, card_id: thothIds[5], orientation: 'upright' },
        ],
      },
    });
    expect(rpc.error?.code).toBe('23514');
  });

  it('rolls back the whole reading when a card insert fails (no partial reading)', async () => {
    const before = await countReadings(user.id);
    // Card 3 belongs to the other deck: the reading row is inserted first, then the trigger fires.
    const bad = physical({
      cards: [
        { position_index: 0, card_id: rwsIds[10]!, orientation: 'upright' },
        { position_index: 1, card_id: rwsIds[11]!, orientation: 'upright' },
        { position_index: 2, card_id: thothIds[12]!, orientation: 'upright' },
      ],
    });
    await expect(createReading(user.client, bad)).rejects.toMatchObject({ code: '23514' });
    expect(await countReadings(user.id)).toBe(before);
    expect(await countOrphanCards(user.id)).toBe(0);

    // Wrong card count for the spread is refused before any insert.
    const short = physical({ cards: physical().cards.slice(0, 2) });
    const rpc = await user.client.rpc('create_reading', { p: short });
    expect(rpc.error?.code).toBe('23514');
    expect(await countReadings(user.id)).toBe(before);
  });

  it('a back-dated occurred_at persists and drives ordering', async () => {
    const past = '2026-03-01T09:30:00.000Z';
    const id = await createReading(user.client, physical({ occurred_at: past }));
    const r = (await getReading(user.client, id))!;
    expect(new Date(r.occurred_at).toISOString()).toBe(past);
    const list = await listReadings(user.client, { limit: 50 });
    expect(list.at(-1)?.id).toBe(id);
    expect(list[0]!.deck.name).toBeTruthy();
    expect(list[0]!.spread.card_count).toBe(3);
  });

  it('a custom spread can be created and used in a reading immediately; deleting it while in use is refused', async () => {
    const custom = await createCustomSpread(user.client, user.id, {
      name: 'Week ahead',
      description: '',
      positions: [
        { name: 'Monday', prompt: '' },
        { name: 'Midweek', prompt: 'What the middle of the week asks for, and what to let go of.' },
        { name: 'Weekend', prompt: '' },
        { name: 'Thread', prompt: '' },
      ],
    });
    expect(custom.slug).toBe('week-ahead');
    expect(custom.card_count).toBe(4);
    expect(custom.positions.map((p) => p.key)).toEqual(['monday', 'midweek', 'weekend', 'thread']);
    expect(custom.positions[0]!.prompt.length).toBeGreaterThanOrEqual(20);
    expect(custom.layout.slots).toHaveLength(4);
    expect((await listSpreads(user.client)).some((s) => s.id === custom.id)).toBe(true);
    expect((await listCustomSpreads(user.client)).map((s) => s.id)).toContain(custom.id);

    // Same name again → suffixed slug, not an error.
    const again = await createCustomSpread(user.client, user.id, {
      name: 'Week ahead',
      description: 'second',
      positions: [{ name: 'Only', prompt: '' }],
    });
    expect(again.slug).toBe('week-ahead-2');

    const id = await createReading(
      user.client,
      physical({
        spread_id: custom.id,
        cards: [0, 1, 2, 3].map((i) => ({
          position_index: i,
          card_id: rwsIds[20 + i]!,
          orientation: 'upright' as const,
        })),
      }),
    );
    const r = (await getReading(user.client, id))!;
    expect(r.cards.map((c) => c.position_key)).toEqual(['monday', 'midweek', 'weekend', 'thread']);
    expect(r.cards[3]!.position?.name).toBe('Thread');

    expect(await deleteCustomSpread(user.client, custom.id)).toBe('in_use');
    expect(await deleteCustomSpread(user.client, again.id)).toBe('deleted');
    expect(await deleteCustomSpread(user.client, again.id)).toBe('missing');
  });

  it('revisit date, follow-up status and notes persist; cards can be replaced atomically', async () => {
    const id = await createReading(user.client, physical());
    await setRevisitAt(user.client, id, '2026-10-12T00:00:00.000Z');
    await setFollowUpStatus(user.client, id, 'partly_resolved');
    await updateReadingNotes(user.client, id, '  New note, my own words.  ');
    await updateReading(user.client, id, {
      question: 'Edited question',
      is_open_reflection: false,
      life_area: null,
      occurred_at: '2026-09-01T12:00:00.000Z',
    });
    let r = (await getReading(user.client, id))!;
    expect(r.revisit_at).toBe('2026-10-12T00:00:00+00:00');
    expect(r.follow_up_status).toBe('partly_resolved');
    expect(r.user_notes).toBe('New note, my own words.');
    expect(r.question).toBe('Edited question');
    expect(r.life_area).toBeNull();
    expect(new Date(r.occurred_at).toISOString()).toBe('2026-09-01T12:00:00.000Z');
    // A question edit bumps the version (an interpretation for the old question is stale).
    expect(r.metadata_version).toBe(2);

    await replaceReadingCards(user.client, id, [
      { position_index: 0, card_id: rwsIds[30]!, orientation: 'reversed' },
      { position_index: 1, card_id: rwsIds[31]!, orientation: 'upright' },
      { position_index: 2, card_id: rwsIds[32]!, orientation: 'upright' },
    ]);
    r = (await getReading(user.client, id))!;
    expect(r.cards.map((c) => c.card.id)).toEqual([rwsIds[30], rwsIds[31], rwsIds[32]]);
    expect(r.cards[0]!.orientation).toBe('reversed');
    expect(r.metadata_version).toBe(3);

    // A bad replacement (foreign deck) leaves the previous cards untouched.
    await expect(
      replaceReadingCards(user.client, id, [
        { position_index: 0, card_id: thothIds[0]!, orientation: 'upright' },
        { position_index: 1, card_id: rwsIds[31]!, orientation: 'upright' },
        { position_index: 2, card_id: rwsIds[32]!, orientation: 'upright' },
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    r = (await getReading(user.client, id))!;
    expect(r.cards.map((c) => c.card.id)).toEqual([rwsIds[30], rwsIds[31], rwsIds[32]]);

    await setRevisitAt(user.client, id, null);
    expect((await getReading(user.client, id))!.revisit_at).toBeNull();

    // Open reflection clears the question.
    await updateReading(user.client, id, {
      question: 'ignored',
      is_open_reflection: true,
      life_area: 'self',
      occurred_at: r.occurred_at,
    });
    expect((await getReading(user.client, id))!.question).toBeNull();
  });

  it('recent card ids come back newest first, deduped, scoped to the deck', async () => {
    const recent = await listRecentCardIds(user.client, rws.id, 5);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThanOrEqual(5);
    expect(new Set(recent).size).toBe(recent.length);
    for (const id of recent) expect(rwsIds).toContain(id);
    expect(recent[0]).toBe(rwsIds[30]); // the last replacement above
  });

  it('soft-deleting a reading hides it at once and keeps the row for the purge job; twice is a no-op', async () => {
    const id = await createReading(
      user.client,
      physical({
        cards: [
          { position_index: 0, card_id: rwsIds[70]!, orientation: 'upright' },
          { position_index: 1, card_id: rwsIds[71]!, orientation: 'upright' },
          { position_index: 2, card_id: rwsIds[72]!, orientation: 'upright' },
        ],
      }),
    );
    expect(await listRecentCardIds(user.client, rws.id)).toContain(rwsIds[70]);
    expect(await softDeleteReading(user.client, id)).toBe(true);
    expect(await getReading(user.client, id)).toBeNull();
    expect((await listReadings(user.client)).map((r) => r.id)).not.toContain(id);
    expect(await listRecentCardIds(user.client, rws.id)).not.toContain(rwsIds[70]);
    const rows = await platformSql()<{ deleted: boolean; cards: string }[]>`
      select deleted_at is not null as deleted,
        (select count(*)::text from reading_cards where reading_id = ${id}) as cards
      from readings where id = ${id}`;
    expect(rows[0]).toEqual({ deleted: true, cards: '3' });
    expect(await softDeleteReading(user.client, id)).toBe(false);
  });

  it('the server draft round-trips, survives as the user left it, and goes away on delete', async () => {
    expect(await getServerDraft(user.client, user.id)).toBeNull();
    let draft = newDraft({ deck: rws, source: 'physical', useReversals: true });
    draft = setSpread(draft, spread('three-card'));
    draft = placeCard(draft, 0, rwsIds[5]!);
    await upsertServerDraft(user.client, user.id, draft);
    expect(await getServerDraft(user.client, user.id)).toEqual(draft);
    draft = placeCard(draft, 1, rwsIds[6]!);
    await upsertServerDraft(user.client, user.id, draft);
    expect((await getServerDraft(user.client, user.id))?.cards[1]?.card_id).toBe(rwsIds[6]);
    await deleteServerDraft(user.client, user.id);
    expect(await getServerDraft(user.client, user.id)).toBeNull();
  });

  async function countReadings(userId: string): Promise<number> {
    const rows = await platformSql()<{ n: string }[]>`
      select count(*)::text as n from readings where user_id = ${userId}`;
    return Number(rows[0]?.n ?? 0);
  }
  async function countOrphanCards(userId: string): Promise<number> {
    const rows = await platformSql()<{ n: string }[]>`
      select count(*)::text as n from reading_cards rc
      where rc.user_id = ${userId} and not exists (select 1 from readings r where r.id = rc.reading_id)`;
    return Number(rows[0]?.n ?? 0);
  }
});
