import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import { countReadings, resolveQueryCardIds, searchJournal } from '@/db/queries/journal';
import { softDeleteReading, updateReadingNotes } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { EMPTY_FILTERS, type JournalFilters } from '@/domain/journal/filters';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  storeInterpretation,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Journal search against Postgres (FR-07, FR-21): FTS over question and notes, the trigram
 * fallback, card search through aliases with deck-native names, filter composition, sorts,
 * keyset pagination that stays stable while rows are inserted, and soft-deleted rows absent
 * from every result. Nothing here reaches a model.
 */
const f = (over: Partial<JournalFilters>): JournalFilters => ({ ...EMPTY_FILTERS, ...over });
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 12)).toISOString();

describe('journal search (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;
  const ids = {} as Record<'strength' | 'lust' | 'open' | 'withAi' | 'deleted', string>;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('journal');
    refs = await loadJournalRefs(user);
    // A small, varied journal: both decks, both sources, notes or not, an interpretation.
    ids.strength = (
      await makeReading(user, refs, {
        deck: 'rws',
        cards: ['strength', 'the-tower', 'ace-of-cups'],
        question: 'Should I take the job in Lisbon?',
        notes: 'A lot of pentacles lately. Money and ground, again.',
        lifeArea: 'work',
        occurredAt: day(10),
        source: 'physical',
      })
    ).id;
    ids.lust = (
      await makeReading(user, refs, {
        deck: 'thoth',
        cards: ['lust', 'the-universe', 'princess-of-disks'],
        question: 'What is this relationship asking of me?',
        notes: null,
        lifeArea: 'relationships',
        occurredAt: day(20),
        source: 'physical',
      })
    ).id;
    ids.open = (
      await makeReading(user, refs, {
        deck: 'rws',
        cards: ['the-hermit'],
        spread: 'one-card',
        question: null,
        notes: 'Quiet morning. The Hermit felt right.',
        occurredAt: day(30),
        source: 'physical',
      })
    ).id;
    const withAi = await makeReading(user, refs, {
      deck: 'thoth',
      cards: ['the-magus'],
      spread: 'one-card',
      question: 'Will the flat viewing on Friday go well?',
      notes: null,
      occurredAt: day(40),
      source: 'physical',
    });
    ids.withAi = withAi.id;
    await storeInterpretation(user, withAi);
    ids.deleted = (
      await makeReading(user, refs, {
        question: 'Deleted: Lisbon again',
        notes: 'pentacles pentacles',
        occurredAt: day(50),
      })
    ).id;
    await softDeleteReading(user.client, ids.deleted);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  const idsOf = async (filters: Partial<JournalFilters>, opts = {}) =>
    (await searchJournal(user.client, f(filters), opts)).items.map((i) => i.id);

  it('lists newest first with every stored column the timeline needs; soft-deleted rows never appear', async () => {
    const page = await searchJournal(user.client, EMPTY_FILTERS);
    expect(page.items.map((i) => i.id)).toEqual([ids.withAi, ids.open, ids.lust, ids.strength]);
    expect(page.nextCursor).toBeNull();
    expect(await countReadings(user.client)).toBe(4);
    const lust = page.items.find((i) => i.id === ids.lust)!;
    expect(lust.deck.system).toBe('thoth');
    expect(lust.cards.map((c) => c.card.name)).toEqual([
      'Lust',
      'The Universe',
      'Princess of Disks',
    ]);
    expect(lust.spread.name).toMatch(/Past/);
    const ai = page.items.find((i) => i.id === ids.withAi)!;
    expect(ai.synthesis).toMatch(/^Taken together/);
    expect(page.items.find((i) => i.id === ids.open)!.synthesis).toBeNull();
  });

  it('full-text search matches the question and the notes; the trigram fallback forgives a typo', async () => {
    expect(await idsOf({ q: 'Lisbon' })).toEqual([ids.strength]);
    expect(await idsOf({ q: 'pentacles money' })).toEqual([ids.strength]);
    expect(await idsOf({ q: 'quiet morning' })).toEqual([ids.open]);
    expect(await idsOf({ q: '"flat viewing"' })).toEqual([ids.withAi]);
    // Typo: no FTS token matches "pentacels"; word similarity does.
    expect(await idsOf({ q: 'pentacels' })).toEqual([ids.strength]);
    expect(await idsOf({ q: 'zebra' })).toEqual([]);
  });

  it('card search resolves through aliases across decks and returns each card under its own deck-native name', async () => {
    const cardIds = await resolveQueryCardIds(user.client, 'strength');
    expect(cardIds).toContain(refs.cardId('rws', 'strength'));
    expect(cardIds).toContain(refs.cardId('thoth', 'lust'));
    const page = await searchJournal(user.client, f({ q: 'strength' }));
    expect(page.items.map((i) => i.id).sort()).toEqual([ids.lust, ids.strength].sort());
    const thothHit = page.items.find((i) => i.id === ids.lust)!;
    const matched = thothHit.cards.filter((c) => page.matchedCardIds.includes(c.card.id));
    expect(matched.map((c) => c.card.name)).toEqual(['Lust']);
    expect(JSON.stringify(thothHit)).not.toMatch(/Strength|Pentacles/);
    // "hermit" finds the open reflection by its card, though neither question nor note says so… the note does; use the tower instead.
    expect(await idsOf({ q: 'tower' })).toEqual([ids.strength]);
    // A word that is not a card and not in any text finds nothing — no fuzzy card noise.
    expect(await idsOf({ q: 'money' })).toEqual([ids.strength]);
  });

  it.each<[string, Partial<JournalFilters>, () => (string | undefined)[]]>([
    ['deck = thoth', { deck: 'thoth' }, () => [ids.withAi, ids.lust]],
    [
      'deck = rws + has notes',
      { deck: 'rws-classic', hasNotes: true },
      () => [ids.open, ids.strength],
    ],
    ['no notes', { hasNotes: false }, () => [ids.withAi, ids.lust]],
    ['has interpretation', { hasInterpretation: true }, () => [ids.withAi]],
    ['no interpretation + thoth', { hasInterpretation: false, deck: 'thoth' }, () => [ids.lust]],
    ['date range Jan 15–25', { from: '2026-01-15', to: '2026-01-25' }, () => [ids.lust]],
    ['from Jan 25', { from: '2026-01-25' }, () => [ids.withAi, ids.open]],
    ['to Jan 11 (inclusive day)', { to: '2026-01-11' }, () => [ids.strength]],
    ['life-area-less text + deck', { q: 'Lisbon', deck: 'thoth' }, () => []],
    [
      'follow-up unresolved',
      { followUp: 'unresolved' },
      () => [ids.withAi, ids.open, ids.lust, ids.strength],
    ],
    ['follow-up resolved', { followUp: 'resolved' }, () => []],
    [
      'source physical',
      { source: 'physical' },
      () => [ids.withAi, ids.open, ids.lust, ids.strength],
    ],
    ['source digital', { source: 'digital' }, () => []],
    ['unknown deck slug', { deck: 'marseille' }, () => []],
  ])('filters compose: %s', async (_label, filters, expected) => {
    expect(await idsOf(filters)).toEqual(expected());
  });

  it('a spread filter narrows to that spread', async () => {
    expect(await idsOf({ spread: refs.spread('one-card').id })).toEqual([ids.withAi, ids.open]);
  });

  it('sorts: oldest first, and recently edited puts the last-touched reading first', async () => {
    expect(await idsOf({ sort: 'oldest' })).toEqual([ids.strength, ids.lust, ids.open, ids.withAi]);
    await updateReadingNotes(user.client, ids.strength, 'Edited just now.');
    expect((await idsOf({ sort: 'edited' }))[0]).toBe(ids.strength);
  });

  it('keyset pagination stays stable while rows are inserted between pages', async () => {
    const first = await searchJournal(user.client, EMPTY_FILTERS, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    // A newer reading lands between page 1 and page 2: an offset would shift; a keyset does not.
    const newer = await makeReading(user, refs, {
      question: 'Inserted mid-scroll',
      occurredAt: day(60),
    });
    const second = await searchJournal(user.client, EMPTY_FILTERS, {
      limit: 2,
      cursor: first.nextCursor,
    });
    const seen = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([ids.withAi, ids.open, ids.lust, ids.strength]);
    expect(second.nextCursor).toBeNull();
    // Page size 3 with 5 rows: the last page is one row and closes the cursor.
    const p1 = await searchJournal(user.client, EMPTY_FILTERS, { limit: 3 });
    const p2 = await searchJournal(user.client, EMPTY_FILTERS, { limit: 3, cursor: p1.nextCursor });
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual([
      newer.id,
      ids.withAi,
      ids.open,
      ids.lust,
      ids.strength,
    ]);
    expect(p2.nextCursor).toBeNull();
    // The inserted row is at the top of a fresh first page.
    expect((await idsOf({}))[0]).toBe(newer.id);
    // Garbage cursors start from the top rather than failing.
    expect((await searchJournal(user.client, EMPTY_FILTERS, { cursor: 'nope' })).items[0]?.id).toBe(
      newer.id,
    );
    await softDeleteReading(user.client, newer.id);
  });

  it('the date range respects the viewer’s zone', async () => {
    // day(10) is 2026-01-11T12:00Z. In Pacific/Kiritimati (UTC+14) that is 02:00 on the 12th.
    expect(
      await idsOf({ from: '2026-01-12', to: '2026-01-12' }, { timeZone: 'Pacific/Kiritimati' }),
    ).toEqual([ids.strength]);
    expect(await idsOf({ from: '2026-01-12', to: '2026-01-12' }, { timeZone: 'UTC' })).toEqual([]);
  });

  it('derived rows never surface as text: a deleted reading’s words are gone from search too', async () => {
    const withDerived = await makeReading(user, refs, {
      question: 'Unique phrase quokka',
      occurredAt: day(70),
    });
    await attachDerived(user, withDerived);
    expect(await idsOf({ q: 'quokka' })).toEqual([withDerived.id]);
    await softDeleteReading(user.client, withDerived.id);
    expect(await idsOf({ q: 'quokka' })).toEqual([]);
    expect(await idsOf({ hasInterpretation: true })).toEqual([ids.withAi]);
    const rows = await platformSql()<{ n: string }[]>`
      select count(*)::text as n from interpretations where reading_id = ${withDerived.id}`;
    expect(rows[0]?.n).toBe('1'); // still there until the purge job runs
  });
});
