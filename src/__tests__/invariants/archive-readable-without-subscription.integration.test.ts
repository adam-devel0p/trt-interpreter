import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { closeAdmin, platformSql } from '@/db/admin';
import { getInterpretationState } from '@/db/queries/interpretations';
import { searchJournal } from '@/db/queries/journal';
import { getProfile, setAiConsent } from '@/db/queries/profile';
import {
  getReading,
  listNoteRevisions,
  listReadings,
  updateReadingNotes,
} from '@/db/queries/readings';
import { requestExport } from '@/db/queries/exports';
import { seedReferenceData } from '@/db/seed/reference';
import { EMPTY_FILTERS } from '@/domain/journal/filters';
import { buildExportArchive } from '@/export/build';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Invariant 11 against Postgres: with the plan set to `free` (the least any account can be),
 * AI consent withdrawn and the account carrying nothing but its archive, the journal list,
 * search, the reading detail (with its stored interpretation), the note history and the
 * export all still work. Phase 11 adds usage limits; this test must then also exhaust them.
 */
describe('archive-readable-without-subscription (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('free');
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('journal, search, detail, history and export all work on the free plan with AI off', async () => {
    await setAiConsent(user.client, user.id, true);
    const reading = await makeReading(user, refs, {
      question: 'Readable forever?',
      notes: 'These words are mine.',
    });
    await updateReadingNotes(user.client, reading.id, 'Still mine, edited.');
    await attachDerived(user, reading);

    // Downgrade to the floor: free plan, consent withdrawn.
    await platformSql()`update profiles set plan = 'free' where id = ${user.id}`;
    await setAiConsent(user.client, user.id, false);
    const profile = (await getProfile(user.client, user.id))!;
    expect(profile.plan).toBe('free');
    expect(profile.ai_consent_at).toBeNull();

    expect((await listReadings(user.client)).map((r) => r.id)).toContain(reading.id);
    const page = await searchJournal(user.client, { ...EMPTY_FILTERS, q: 'readable' });
    expect(page.items.map((i) => i.id)).toEqual([reading.id]);
    expect(page.items[0]!.synthesis).toMatch(/^Taken together/);

    const detail = (await getReading(user.client, reading.id))!;
    expect(detail.user_notes).toBe('Still mine, edited.');
    expect(detail.cards).toHaveLength(3);
    const state = await getInterpretationState(user.client, reading.id);
    expect(state.current?.synthesis).toMatch(/^Taken together/);
    expect((await listNoteRevisions(user.client, reading.id)).map((v) => v.content)).toEqual([
      'These words are mine.',
    ]);

    const exportId = await requestExport(user.client, user.id);
    expect(exportId).toMatch(/^[0-9a-f-]{36}$/);
    const built = await buildExportArchive(user.id);
    const files = unzipSync(built.bytes);
    const readings = JSON.parse(strFromU8(files['readings.json']!)) as {
      id: string;
      user_notes: string;
    }[];
    expect(readings.map((r) => r.id)).toEqual([reading.id]);
    expect(readings[0]!.user_notes).toBe('Still mine, edited.');
    const interpretations = JSON.parse(strFromU8(files['interpretations.json']!)) as {
      reading_id: string;
    }[];
    expect(interpretations).toHaveLength(1);
    expect(JSON.parse(strFromU8(files['profile.json']!)).plan).toBe('free');
  });
});
