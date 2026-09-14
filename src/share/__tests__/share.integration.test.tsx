import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { closeAdmin, platformSql } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import { buildReadingCard, DEFAULT_SHARE_OPTIONS } from '@/domain/share/payload';
import { loadArt, loadReadingForShare } from '@/share/load';
import { CARD_H, CARD_W, ReadingCard, shareFonts } from '@/share/render';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Share cards against the database and the real renderer (FR-24): the loader reads the
 * owner's reading through RLS, the default payload carries no note, question or name, and
 * the image route's renderer produces a PNG of the right size from it — for RWS with art
 * and for Thoth with the typographic face.
 */
describe('share cards (integration)', () => {
  let user: TestUser;
  let other: TestUser;
  let refs: JournalRefs;
  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('share');
    other = await createTestUser('share-other');
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await deleteTestUser(other);
    await closeAdmin();
  });

  it('loads the owner’s reading (and nobody else’s), defaults to private, and renders a PNG', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Will Maya and I move to Leeds?',
      notes: 'Terrified. Dad would hate it.',
    });
    await attachDerived(user, reading, { memory: true });
    expect(await loadReadingForShare(other.client, reading.id)).toBeNull();
    const forShare = (await loadReadingForShare(user.client, reading.id))!;
    expect(forShare.cards).toHaveLength(3);
    expect(forShare.question).toContain('Maya');
    const payload = buildReadingCard(forShare, DEFAULT_SHARE_OPTIONS);
    const json = JSON.stringify(payload);
    for (const word of ['Maya', 'Leeds', 'Dad', 'Terrified', 'move'])
      expect(json).not.toContain(word);
    expect(payload.cards.map((c) => c.name)).toEqual(['Strength', 'The Tower', 'Ace of Cups']);
    const [art, fonts] = await Promise.all([
      loadArt(payload.cards.map((c) => c.artPath)),
      shareFonts(),
    ]);
    expect(Object.keys(art)).toHaveLength(3);
    const res = new ImageResponse(<ReadingCard payload={payload} art={art} />, {
      width: CARD_W,
      height: CARD_H,
      fonts,
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBeGreaterThan(20_000);
    // Opted in: the question appears in the payload, the note still does not.
    const withQuestion = buildReadingCard(forShare, { question: true });
    expect(withQuestion.question).toContain('Maya');
    expect(withQuestion.note).toBeNull();
  });

  it('a Thoth reading renders with its own names and no RWS art', async () => {
    const reading = await makeReading(user, refs, { deck: 'thoth', question: 'Thoth?' });
    const forShare = (await loadReadingForShare(user.client, reading.id))!;
    const payload = buildReadingCard(forShare);
    expect(payload.deckSystem).toBe('thoth');
    expect(payload.cards.map((c) => c.name)).toEqual(['Lust', 'The Universe', 'Princess of Disks']);
    expect(payload.cards.every((c) => c.artPath === null)).toBe(true);
    expect(await loadArt(payload.cards.map((c) => c.artPath))).toEqual({});
    const res = new ImageResponse(<ReadingCard payload={payload} art={{}} />, {
      width: CARD_W,
      height: CARD_H,
      fonts: await shareFonts(),
    });
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    const [n] = await platformSql()<
      { n: number }[]
    >`select count(*)::int as n from readings where user_id = ${user.id}`;
    expect(n!.n).toBe(2);
  });
});
