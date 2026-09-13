import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAiRunner, getMockProvider, resetAiForTests } from '@/ai';
import { closeAdmin, platformDb, recentAiCalls } from '@/db/admin';
import { entities, entityMentions, extractions, jobs, objectThemes } from '@/db/schema';
import { getReadingMemory } from '@/db/queries/memory';
import { setAiConsent } from '@/db/queries/profile';
import { getReading, updateReadingNotes } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { enqueue } from '@/jobs/enqueue';
import { runBatch } from '@/jobs/worker';
import { applyCorrection } from '@/memory/corrections';
import { runExtraction } from '@/memory/extract';
import { loadJournalRefs, makeReading, type JournalRefs } from '@/__tests__/fixtures/journal-db';
import { enableExtraction } from '@/__tests__/fixtures/memory-db';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';

/**
 * The extraction run against Postgres with the mock provider (spec §7.2, FR-08, FR-09,
 * FR-26): a versioned payload persisted after the reading exists; append-only supersession;
 * overrides that survive re-extraction; failure leaving the reading untouched with the job
 * retrying; consent and flag gates; freshness; and resolution across readings — a descriptor
 * then a name collapse into one entity, a pronoun never does, a name shared by two entities
 * asks exactly once and the answer pins it.
 */
describe('extraction (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    resetAiForTests();
    user = await createTestUser('extract');
    await setAiConsent(user.client, user.id, true);
    await enableExtraction(user.id);
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  const memory = async (readingId: string) => {
    const r = (await getReading(user.client, readingId))!;
    return getReadingMemory(user.client, r);
  };

  it('persists a versioned payload after the reading exists, materialises it, and leaves the reading byte-identical', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Should I take the job in Lisbon?',
      notes: 'My girlfriend thinks I should. A lot of pentacles lately.',
      lifeArea: 'work',
    });
    const before = JSON.stringify(await getReading(user.client, reading.id));
    const out = await runExtraction(reading.id, { runner: getAiRunner() });
    expect(out.status).toBe('complete');
    if (out.status !== 'complete') return;
    const [row] = await platformDb()
      .select()
      .from(extractions)
      .where(eq(extractions.id, out.extractionId));
    expect(row).toMatchObject({
      status: 'complete',
      objectType: 'reading',
      objectId: reading.id,
      schemaVersion: 'extraction/1.0.0',
      promptVersion: 'extract_reading_metadata/1.0.0',
      modelId: 'mock/claude-sonnet-5',
      metadataVersion: reading.metadata_version,
      supersededBy: null,
    });
    expect(row!.payload).toMatchObject({ life_area: 'work' });
    expect(JSON.stringify(row!.payload)).not.toMatch(/probab/i);
    expect(JSON.stringify(await getReading(user.client, reading.id))).toBe(before);

    const m = await memory(reading.id);
    expect(m.latest?.status).toBe('complete');
    expect(m.stale).toBe(false);
    expect(m.effective?.lifeArea).toEqual({ value: 'work', source: 'model' });
    expect(m.mentions.map((x) => [x.mention_text, x.entity.kind, x.resolution]).sort()).toEqual([
      ['Lisbon', 'place', 'auto'],
      ['My girlfriend', 'person', 'auto'],
    ]);
    // Born unconfirmed, with a role and an alias from the framing.
    const gf = m.mentions.find((x) => x.mention_text === 'My girlfriend')!.entity;
    expect(gf.user_confirmed).toBe(false);
    expect(gf.roles).toEqual(['partner']);
    expect(m.themes.map((t) => t.slug)).toContain('decision');
    expect(m.themes.every((t) => t.source === 'model' && !t.user_confirmed)).toBe(true);
    expect(m.predictions).toHaveLength(1);
    expect(m.predictions[0]).toMatchObject({ fact_status: 'POSSIBILITY', user_edited: false });
    const calls = await recentAiCalls(5);
    expect(calls[0]).toMatchObject({
      task: 'extract_reading_metadata',
      status: 'ok',
      userId: user.id,
    });
  });

  it('a second run is "fresh" unless forced; a forced run supersedes without deleting', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Will the flat viewing on Friday go well?',
    });
    const first = await runExtraction(reading.id);
    expect(first.status).toBe('complete');
    expect((await runExtraction(reading.id)).status).toBe('skipped');
    const second = await runExtraction(reading.id, { force: true });
    expect(second.status).toBe('complete');
    const rows = await platformDb()
      .select({
        id: extractions.id,
        supersededBy: extractions.supersededBy,
        status: extractions.status,
      })
      .from(extractions)
      .where(eq(extractions.objectId, reading.id));
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === (first as { extractionId: string }).extractionId)!;
    const b = rows.find((r) => r.id === (second as { extractionId: string }).extractionId)!;
    expect(a.supersededBy).toBe(b.id);
    expect(b.supersededBy).toBeNull();
    // A notes edit changes the source hash → stale → a plain run extracts again.
    await updateReadingNotes(user.client, reading.id, 'Nervous about the landlord.');
    expect((await memory(reading.id)).stale).toBe(true);
    expect((await runExtraction(reading.id)).status).toBe('complete');
    expect((await memory(reading.id)).stale).toBe(false);
  });

  it('corrections are authoritative and survive re-extraction and reprocessing', async () => {
    const reading = await makeReading(user, refs, {
      question: 'Should I say yes to the conference talk?',
      notes: 'Worried about the review. Sam said go for it.',
    });
    await runExtraction(reading.id);
    let m = await memory(reading.id);
    expect(m.themes.map((t) => t.slug)).toContain('anxiety');
    expect(m.mentions.map((x) => x.mention_text)).toContain('Sam');

    await applyCorrection(user.client, user.id, reading.id, {
      type: 'dismiss_theme',
      slug: 'anxiety',
    });
    await applyCorrection(user.client, user.id, reading.id, { type: 'add_theme', label: 'Trust' });
    await applyCorrection(user.client, user.id, reading.id, {
      type: 'set_life_area',
      value: 'creativity',
    });
    await applyCorrection(user.client, user.id, reading.id, {
      type: 'dismiss_entity',
      mention: 'Sam',
    });
    m = await memory(reading.id);
    expect(m.themes.map((t) => t.slug)).not.toContain('anxiety');
    expect(m.themes.find((t) => t.slug === 'trust')).toMatchObject({
      source: 'user',
      user_confirmed: true,
    });
    expect(m.effective?.lifeArea).toEqual({ value: 'creativity', source: 'user' });
    expect(m.mentions.map((x) => x.mention_text)).not.toContain('Sam');

    // Re-extraction under a newer schema (reprocess) keeps every correction.
    await runExtraction(reading.id, {
      force: true,
      versions: { promptVersion: 'p/2', schemaVersion: 'extraction/9.9.9' },
    });
    const job = await enqueue('reprocess_extractions', {
      toSchema: 'extraction/1.0.0',
      userId: user.id,
      limit: 10,
    });
    expect(await runBatch({ jobId: job.id })).toMatchObject({ succeeded: 1 });
    m = await memory(reading.id);
    expect(m.latest?.schema_version).toBe('extraction/1.0.0');
    expect(m.themes.map((t) => t.slug)).not.toContain('anxiety');
    expect(m.themes.map((t) => t.slug)).toContain('trust');
    expect(m.effective?.lifeArea.value).toBe('creativity');
    expect(m.mentions.map((x) => x.mention_text)).not.toContain('Sam');
    const history = await platformDb()
      .select()
      .from(extractions)
      .where(eq(extractions.objectId, reading.id));
    expect(history.length).toBe(3);
    expect(history.filter((h) => h.supersededBy === null && h.status === 'complete')).toHaveLength(
      1,
    );
    // Clearing a correction lets the extraction speak again.
    await applyCorrection(user.client, user.id, reading.id, {
      type: 'clear',
      fieldPath: 'themes/anxiety',
    });
    expect((await memory(reading.id)).themes.map((t) => t.slug)).toContain('anxiety');
  });

  it('a provider failure leaves the reading untouched, records the class, and the job retries', async () => {
    const reading = await makeReading(user, refs, {
      question: 'What am I avoiding about the tax letter?',
    });
    const before = JSON.stringify(await getReading(user.client, reading.id));
    getAiRunner();
    getMockProvider()!.failWith('500', 3);
    const job = await enqueue(
      'extract_reading_metadata',
      { readingId: reading.id },
      { userId: user.id, maxAttempts: 3 },
    );
    const result = await runBatch({ jobId: job.id });
    expect(result).toMatchObject({ claimed: 1, retried: 1, succeeded: 0 });
    const [j] = await platformDb().select().from(jobs).where(eq(jobs.id, job.id));
    expect(j).toMatchObject({ status: 'queued', lastErrorClass: 'ExtractionRetry' });
    const m = await memory(reading.id);
    expect(m.latest).toMatchObject({ status: 'failed', error_class: 'server_error' });
    expect(m.effective).toBeNull();
    expect(m.mentions).toEqual([]);
    expect(JSON.stringify(await getReading(user.client, reading.id))).toBe(before);
    // Retry succeeds (a named job is claimed regardless of its backoff): the failed row
    // stays as history, a new one is current.
    expect(await runBatch({ jobId: job.id })).toMatchObject({ claimed: 1, succeeded: 1 });
    const rows = await platformDb()
      .select()
      .from(extractions)
      .where(eq(extractions.objectId, reading.id));
    expect(rows.map((r) => r.status).sort()).toEqual(['complete', 'failed']);
    // Invalid output is terminal (the runner already repaired once): no retry.
    const r2 = await makeReading(user, refs, { question: 'Is the workshop idea alive?' });
    getMockProvider()!.respondWith({ nonsense: true });
    getMockProvider()!.respondWith({ nonsense: true });
    const out = await runExtraction(r2.id);
    expect(out).toMatchObject({ status: 'failed', retryable: false });
  });

  it('no consent → no extraction, no model call; flag off → the same', async () => {
    const other = await createTestUser('noconsent');
    try {
      const otherRefs = await loadJournalRefs(other);
      const r = await makeReading(other, otherRefs, { question: 'Should I move to Leeds?' });
      const callsBefore = (await recentAiCalls(100)).length;
      expect(await runExtraction(r.id)).toEqual({ status: 'skipped', reason: 'consent' });
      await setAiConsent(other.client, other.id, true);
      expect(await runExtraction(r.id)).toEqual({ status: 'skipped', reason: 'flag' });
      expect((await recentAiCalls(100)).length).toBe(callsBefore);
      expect(
        await platformDb().select().from(extractions).where(eq(extractions.userId, other.id)),
      ).toEqual([]);
      // A job for a non-consenting user succeeds quietly (nothing to retry).
      const job = await enqueue(
        'extract_reading_metadata',
        { readingId: r.id },
        { userId: other.id },
      );
      expect(await runBatch({ jobId: job.id })).toMatchObject({ succeeded: 1 });
    } finally {
      await deleteTestUser(other);
    }
  });

  it('resolution across readings: descriptor → name collapse, pronoun never, same name asks once, the answer pins', async () => {
    const solo = await createTestUser('resolve');
    try {
      await setAiConsent(solo.client, solo.id, true);
      await enableExtraction(solo.id);
      const sRefs = await loadJournalRefs(solo);
      const day = (n: number) => new Date(Date.UTC(2026, 2, 1 + n, 12)).toISOString();
      const r1 = await makeReading(solo, sRefs, {
        question: 'What is unresolved between my girlfriend and me?',
        occurredAt: day(0),
      });
      await runExtraction(r1.id);
      const r2 = await makeReading(solo, sRefs, {
        question: null,
        notes: 'Alex, my girlfriend, said she needs space this week.',
        occurredAt: day(10),
      });
      await runExtraction(r2.id);
      const active = await platformDb().select().from(entities).where(eq(entities.userId, solo.id));
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        canonicalLabel: 'Alex',
        kind: 'person',
        userConfirmed: false,
      });
      const m2 = await getReadingMemory(solo.client, (await getReading(solo.client, r2.id))!);
      // Both surface forms in the note point at the one entity.
      expect(m2.mentions.map((x) => [x.mention_text, x.resolution]).sort()).toEqual([
        ['Alex', 'auto'],
        ['my girlfriend', 'auto'],
      ]);
      expect(new Set(m2.mentions.map((x) => x.entity_id)).size).toBe(1);
      expect(m2.mentions.find((x) => x.mention_text === 'Alex')!.reasons.join(' ')).toMatch(
        /partner/,
      );
      // A bare pronoun never becomes or resolves an entity.
      const r3 = await makeReading(solo, sRefs, {
        question: null,
        notes: 'She called again. I did not pick up.',
        occurredAt: day(12),
      });
      await runExtraction(r3.id);
      expect(
        await platformDb().select().from(entityMentions).where(eq(entityMentions.objectId, r3.id)),
      ).toEqual([]);
      expect(
        await platformDb().select().from(entities).where(eq(entities.userId, solo.id)),
      ).toHaveLength(1);

      // Two Alexes with different roles: the user created a second one; a bare "Alex" asks.
      const { createEntity, addRole } = await import('@/db/queries/memory');
      const second = await createEntity(solo.client, solo.id, { label: 'Alex', kind: 'person' });
      await addRole(solo.client, solo.id, second.id, 'colleague', '2026-03-01');
      const r4 = await makeReading(solo, sRefs, {
        question: 'How do I keep the friendship with Alex alive?',
        occurredAt: day(20),
      });
      await runExtraction(r4.id);
      let m4 = await getReadingMemory(solo.client, (await getReading(solo.client, r4.id))!);
      expect(m4.mentions).toHaveLength(1);
      expect(m4.mentions[0]!.resolution).toBe('tentative');
      expect(m4.mentions[0]!.ask_options.map((o) => o.roles)).toEqual(
        expect.arrayContaining([['partner'], ['colleague']]),
      );
      // The answer pins the mention and the entity; the question is closed.
      await applyCorrection(solo.client, solo.id, r4.id, {
        type: 'link_entity',
        mention: 'Alex',
        entityId: second.id,
      });
      m4 = await getReadingMemory(solo.client, (await getReading(solo.client, r4.id))!);
      expect(m4.mentions[0]).toMatchObject({
        resolution: 'user',
        entity_id: second.id,
        ask_candidates: null,
      });
      expect(m4.mentions[0]!.entity.user_confirmed).toBe(true);
      // A re-extraction cannot flip it back.
      await runExtraction(r4.id, { force: true });
      m4 = await getReadingMemory(solo.client, (await getReading(solo.client, r4.id))!);
      expect(m4.mentions[0]).toMatchObject({ resolution: 'user', entity_id: second.id });
      // And "someone else" creates a confirmed entity from the mention.
      const r5 = await makeReading(solo, sRefs, {
        question: null,
        notes: 'Drinks with Jordan on Friday.',
        occurredAt: day(25),
      });
      await runExtraction(r5.id);
      await applyCorrection(solo.client, solo.id, r5.id, {
        type: 'new_entity',
        mention: 'Jordan',
        label: 'Jordan from the club',
      });
      const m5 = await getReadingMemory(solo.client, (await getReading(solo.client, r5.id))!);
      expect(m5.mentions[0]!.entity).toMatchObject({
        canonical_label: 'Jordan from the club',
        user_confirmed: true,
      });
      // Model-born theme links stay unconfirmed until a user acts.
      const themeRows = await platformDb()
        .select()
        .from(objectThemes)
        .where(eq(objectThemes.userId, solo.id));
      expect(themeRows.every((t) => t.source === 'model' && !t.userConfirmed)).toBe(true);
    } finally {
      await deleteTestUser(solo);
    }
  });
});
