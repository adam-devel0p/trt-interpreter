import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import {
  getReading,
  listNoteRevisions,
  updateReading,
  updateReadingNotes,
} from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Invariant 4 against Postgres: editing the notes three times keeps all three earlier
 * versions and the current text; a question edit is kept too; the history is written by the
 * trigger even for a raw update that bypasses the query layer; attaching every kind of derived
 * artifact leaves the user's words byte-identical; revisions cannot be altered by the user.
 */
describe('raw-text-never-overwritten (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('rawtext');
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('three note edits retain all three earlier versions and the current text', async () => {
    const r = await makeReading(user, refs, { question: 'First question', notes: 'version one' });
    await updateReadingNotes(user.client, r.id, 'version two');
    await updateReadingNotes(user.client, r.id, 'version three');
    await updateReadingNotes(user.client, r.id, 'version four');
    expect((await getReading(user.client, r.id))!.user_notes).toBe('version four');
    const revisions = await listNoteRevisions(user.client, r.id);
    expect(revisions.map((v) => [v.field, v.content])).toEqual([
      ['user_notes', 'version three'],
      ['user_notes', 'version two'],
      ['user_notes', 'version one'],
    ]);
    // Saving the same text again writes nothing new.
    await updateReadingNotes(user.client, r.id, 'version four');
    expect(await listNoteRevisions(user.client, r.id)).toHaveLength(3);

    // A question edit keeps the old question and bumps metadata_version.
    await updateReading(user.client, r.id, {
      question: 'Second question',
      is_open_reflection: false,
      life_area: null,
      occurred_at: r.occurred_at,
    });
    const after = (await getReading(user.client, r.id))!;
    expect(after.question).toBe('Second question');
    expect(after.metadata_version).toBe(r.metadata_version + 1);
    const withQ = await listNoteRevisions(user.client, r.id);
    expect(withQ[0]).toMatchObject({
      field: 'question',
      content: 'First question',
      metadata_version: 1,
    });
    expect(withQ).toHaveLength(4);
  });

  it('the history is kept by the database, whichever path updates the row', async () => {
    const r = await makeReading(user, refs, { notes: 'typed by hand' });
    // A raw service-role update — no query layer, no action — still leaves the old value behind.
    await platformSql()`update readings set user_notes = 'rewritten by a script' where id = ${r.id}`;
    const revisions = await listNoteRevisions(user.client, r.id);
    expect(revisions.map((v) => v.content)).toEqual(['typed by hand']);
    // Clearing the note keeps the last text too.
    await updateReadingNotes(user.client, r.id, '   ');
    expect((await getReading(user.client, r.id))!.user_notes).toBeNull();
    expect((await listNoteRevisions(user.client, r.id)).map((v) => v.content)).toEqual([
      'rewritten by a script',
      'typed by hand',
    ]);
  });

  it('derived artifacts leave the user’s words byte-identical; revisions cannot be edited', async () => {
    const r = await makeReading(user, refs, { question: 'Untouched?', notes: 'Untouched words.' });
    const before = JSON.stringify(await getReading(user.client, r.id));
    await attachDerived(user, r);
    expect(JSON.stringify(await getReading(user.client, r.id))).toBe(before);
    expect(await listNoteRevisions(user.client, r.id)).toEqual([]);

    await updateReadingNotes(user.client, r.id, 'Second words.');
    const [rev] = await listNoteRevisions(user.client, r.id);
    const upd = await user.client
      .from('reading_note_revisions')
      .update({ content: 'tampered' })
      .eq('id', rev!.id)
      .select('id');
    expect(upd.data ?? []).toHaveLength(0);
    const ins = await user.client.from('reading_note_revisions').insert({
      reading_id: r.id,
      user_id: user.id,
      field: 'user_notes',
      content: 'forged',
      metadata_version: 1,
    });
    expect(ins.error).not.toBeNull();
    expect((await listNoteRevisions(user.client, r.id)).map((v) => v.content)).toEqual([
      'Untouched words.',
    ]);
  });
});
