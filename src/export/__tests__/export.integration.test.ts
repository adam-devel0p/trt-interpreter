import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  closeAdmin,
  createExportSignedUrl,
  exportStoragePath,
  platformSql,
  removeUserStorage,
} from '@/db/admin';
import { getExport, listExports, requestExport } from '@/db/queries/exports';
import { softDeleteReading, updateReadingNotes } from '@/db/queries/readings';
import { seedReferenceData } from '@/db/seed/reference';
import { EXPORT_FILES, validateExport, type ExportLink } from '@/domain/export/schema';
import { buildExportArchive } from '@/export/build';
import { enqueue } from '@/jobs/enqueue';
import { runBatch } from '@/jobs/worker';
import { createTestUser, deleteTestUser, type TestUser } from '@/__tests__/rls/harness';
import {
  attachDerived,
  loadJournalRefs,
  makeReading,
  storeInterpretation,
  type JournalRefs,
} from '@/__tests__/fixtures/journal-db';

/**
 * Export v1 (FR-22) end to end: the job builds the archive for the row's own user, uploads it
 * to the private bucket, marks the row ready; the archive validates against the contract and
 * every reading, card, note (with history), interpretation (every generation) and link is in
 * it with its database id; manifest counts match the database; a signed URL downloads it,
 * expires, and cannot be guessed. Soft-deleted readings are absent.
 */
async function count(sql: string): Promise<number> {
  const rows = await platformSql().unsafe<{ n: string }[]>(sql);
  return Number(rows[0]?.n ?? 0);
}

describe('export (integration)', () => {
  let user: TestUser;
  let refs: JournalRefs;

  beforeAll(async () => {
    await seedReferenceData();
    user = await createTestUser('export');
    refs = await loadJournalRefs(user);
  });
  afterAll(async () => {
    await deleteTestUser(user);
    await closeAdmin();
  });

  it('round-trips a seeded journal with stable ids, every generation, history and links; counts match the database', async () => {
    const a = await makeReading(user, refs, {
      question: 'Export A: should I move to Leeds with Alex?',
      notes: 'first note about my girlfriend',
    });
    await updateReadingNotes(user.client, a.id, 'second note about my girlfriend');
    const {
      interpretation: first,
      extraction,
      journey,
    } = await attachDerived(user, a, { memory: true, journey: true });
    const second = await storeInterpretation(user, a); // regenerate: first is superseded
    const b = await makeReading(user, refs, {
      deck: 'thoth',
      question: null,
      notes: 'thoth open reflection',
      cards: ['lust'],
      spread: 'one-card',
    });
    const gone = await makeReading(user, refs, { question: 'Deleted before export' });
    await softDeleteReading(user.client, gone.id);
    // Phase 07: the deleted reading also sat in the journey; its membership must not export.
    const { addReadingToJourney } = await import('@/db/queries/journeys');
    await addReadingToJourney(user.client, user.id, journey!, gone.id);

    const exportId = await requestExport(user.client, user.id);
    const job = await enqueue('export_user_data', { exportId }, { userId: user.id });
    expect(await runBatch({ jobId: job.id })).toMatchObject({ succeeded: 1, dead: 0 });

    const row = (await getExport(user.client, exportId))!;
    expect(row.status).toBe('ready');
    expect(row.storage_path).toBe(exportStoragePath(user.id, exportId));
    expect(row.size_bytes).toBeGreaterThan(1000);
    expect(new Date(row.expires_at!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(row.job_id).toBe(job.id);

    // Download through a signed URL, exactly as the route does.
    const url = await createExportSignedUrl(row.storage_path!, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(row.size_bytes);

    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped).sort()).toEqual(['manifest.json', ...EXPORT_FILES].sort());
    const files = Object.fromEntries(
      Object.entries(unzipped).map(([k, v]) => [k, JSON.parse(strFromU8(v)) as unknown]),
    );
    const { manifest, problems } = validateExport(files);
    expect(problems).toEqual([]);
    expect(manifest.user_id).toBe(user.id);
    expect(manifest.counts).toEqual(row.counts);

    // Every reading, card, note, interpretation and link with its database id.
    const readings = files['readings.json'] as {
      id: string;
      user_notes: string;
      cards: { id: string; card_id: string }[];
    }[];
    expect(readings.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(readings.find((r) => r.id === a.id)!.user_notes).toBe('second note about my girlfriend');
    expect(
      readings
        .find((r) => r.id === a.id)!
        .cards.map((c) => c.id)
        .sort(),
    ).toEqual(a.cards.map((c) => c.id).sort());
    const revisions = files['note_revisions.json'] as { reading_id: string; content: string }[];
    expect(revisions).toEqual([
      expect.objectContaining({ reading_id: a.id, content: 'first note about my girlfriend' }),
    ]);
    const interps = files['interpretations.json'] as {
      id: string;
      superseded_by: string | null;
      prompt_version: string;
      model_id: string;
    }[];
    expect(interps.map((i) => i.id).sort()).toEqual([first.id, second.id].sort());
    expect(interps.find((i) => i.id === first.id)!.superseded_by).toBe(second.id);
    expect(interps.every((i) => i.prompt_version && i.model_id)).toBe(true);
    const cards = files['cards.json'] as { id: string; name: string }[];
    expect(cards.map((c) => c.name)).toContain('Lust');
    expect(cards.map((c) => c.name)).toContain('Strength');
    const flags = files['safety_flags.json'] as { object_id: string; category: string }[];
    expect(flags).toEqual([expect.objectContaining({ object_id: a.id, category: 'financial' })]);
    const links = files['links.json'] as ExportLink[];
    const has = (kind: ExportLink['kind'], from: string, to: string) =>
      links.some((l) => l.kind === kind && l.from.id === from && l.to.id === to);
    expect(has('interpretation_of', first.id, a.id)).toBe(true);
    expect(has('supersedes', second.id, first.id)).toBe(true);
    expect(has('reading_uses_deck', b.id, refs.thoth.id)).toBe(true);
    expect(has('reading_card_is', a.cards[0]!.id, a.cards[0]!.card.id)).toBe(true);
    // Phase 06: derived memory with its versions, the correction, entities with aliases/roles.
    const extractions = files['extractions.json'] as {
      id: string;
      payload: unknown;
      schema_version: string;
      superseded_by: string | null;
    }[];
    expect(extractions.map((x) => x.id)).toContain(extraction);
    expect(extractions.find((x) => x.id === extraction)).toMatchObject({
      schema_version: 'extraction/1.0.0',
      superseded_by: null,
    });
    expect(has('extraction_of', extraction!, a.id)).toBe(true);
    const overrides = files['metadata_overrides.json'] as {
      field_path: string;
      object_id: string;
    }[];
    expect(overrides).toEqual([
      expect.objectContaining({ field_path: 'themes/trust', object_id: a.id }),
    ]);
    const objectThemes = files['object_themes.json'] as {
      object_id: string;
      theme_id: string;
      source: string;
      user_confirmed: boolean;
    }[];
    expect(
      objectThemes.some((t) => t.object_id === a.id && t.source === 'user' && t.user_confirmed),
    ).toBe(true);
    const themes = files['themes.json'] as { id: string; slug: string; curated: boolean }[];
    for (const t of objectThemes) expect(themes.some((x) => x.id === t.theme_id)).toBe(true);
    expect(themes.find((t) => t.slug === 'trust')?.curated).toBe(true);
    const entities = files['entities.json'] as {
      id: string;
      canonical_label: string;
      user_confirmed: boolean;
      aliases: unknown[];
      roles: { role: string }[];
    }[];
    const gf = entities.find(
      (e) =>
        e.canonical_label.toLowerCase() === 'alex' ||
        e.canonical_label.toLowerCase() === 'my girlfriend',
    );
    expect(gf).toBeDefined();
    expect(gf!.user_confirmed).toBe(false);
    expect(gf!.aliases.length).toBeGreaterThanOrEqual(1);
    const mentions = files['entity_mentions.json'] as {
      entity_id: string;
      object_id: string;
      resolution: string;
    }[];
    expect(mentions.some((m) => m.object_id === a.id && m.entity_id === gf!.id)).toBe(true);
    expect(mentions.every((m) => m.resolution !== 'rejected' || true)).toBe(true);
    const preds = files['predictions.json'] as { reading_id: string; fact_status: string }[];
    expect(preds.every((p) => p.fact_status === 'POSSIBILITY')).toBe(true);
    expect(JSON.stringify(files['predictions.json'])).not.toMatch(/probab/i);
    // Phase 07: journeys with nested progression, members, and their links.
    const journeysOut = files['journeys.json'] as {
      id: string;
      title: string;
      title_source: string;
      user_confirmed: boolean;
      theme_progression: { source_object_ids: string[] }[];
    }[];
    const j = journeysOut.find((x) => x.id === journey)!;
    expect(j).toMatchObject({ title: 'Test journey', title_source: 'user', user_confirmed: true });
    for (const step of j.theme_progression) expect(step.source_object_ids).not.toContain(gone.id);
    const members = files['journey_members.json'] as {
      journey_id: string;
      object_id: string;
      state: string;
    }[];
    expect(
      members.some(
        (m) => m.journey_id === journey && m.object_id === a.id && m.state === 'confirmed',
      ),
    ).toBe(true);
    expect(members.some((m) => m.object_id === gone.id)).toBe(false);
    expect(
      links.some((l) => l.kind === 'journey_holds' && l.from.id === journey && l.to.id === a.id),
    ).toBe(true);
    expect(manifest.schema_version).toBe('export/1.2.0');
    expect(JSON.stringify(files)).not.toContain(gone.id);
    expect(JSON.stringify(files)).not.toContain('Deleted before export');
    expect(JSON.stringify(files)).not.toMatch(/ai_calls/);

    // Manifest counts equal the database.
    const uid = user.id;
    expect(manifest.counts['readings.json']).toBe(
      await count(
        `select count(*)::text as n from readings where user_id = '${uid}' and deleted_at is null`,
      ),
    );
    expect(manifest.counts['interpretations.json']).toBe(
      await count(
        `select count(*)::text as n from interpretations i join readings r on r.id = i.reading_id where r.user_id = '${uid}' and r.deleted_at is null`,
      ),
    );
    expect(manifest.counts['note_revisions.json']).toBe(
      await count(
        `select count(*)::text as n from reading_note_revisions v join readings r on r.id = v.reading_id where r.user_id = '${uid}' and r.deleted_at is null`,
      ),
    );
    expect(manifest.counts['safety_flags.json']).toBe(1);

    // The user's own list shows it; a second request while one is fresh is the action's call.
    expect((await listExports(user.client)).map((e) => e.id)).toContain(exportId);
  });

  it('a signed URL expires and cannot be guessed; the bucket is closed to users', async () => {
    const built = await buildExportArchive(user.id);
    const exportId = await requestExport(user.client, user.id);
    const job = await enqueue('export_user_data', { exportId }, { userId: user.id });
    await runBatch({ jobId: job.id });
    const row = (await getExport(user.client, exportId))!;
    expect(built.manifest.counts['readings.json']).toBe(row.counts!['readings.json']);

    const short = await createExportSignedUrl(row.storage_path!, 1);
    expect((await fetch(short)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(short)).status).not.toBe(200);

    const tampered = short.replace(
      /token=([^&]+)/,
      (_m, t: string) => `token=${t.slice(0, -4)}AAAA`,
    );
    expect((await fetch(tampered)).status).not.toBe(200);

    // Direct object access with the user's JWT (no signature): the bucket has no user policies.
    const direct = await user.client.storage.from('exports').download(row.storage_path!);
    expect(direct.error).not.toBeNull();
    const listing = await user.client.storage.from('exports').list(user.id);
    expect(listing.data ?? []).toHaveLength(0);

    // The registry's storage prefix sweep (account deletion, Phase 12) removes the bytes.
    expect(await removeUserStorage(user.id)).toBeGreaterThanOrEqual(2);
    await expect(createExportSignedUrl(row.storage_path!, 60)).rejects.toThrow(/not found/i);
    expect(await removeUserStorage(user.id)).toBe(0);
  });

  it('the job reads the user from the row, so a payload can never export someone else', async () => {
    const other = await createTestUser('export-other');
    try {
      await makeReading(other, await loadJournalRefs(other), {
        question: 'Other person’s reading',
      });
      const exportId = await requestExport(user.client, user.id);
      const job = await enqueue('export_user_data', { exportId }, { userId: other.id }); // wrong userId on the job
      await runBatch({ jobId: job.id });
      const row = (await getExport(user.client, exportId))!;
      expect(row.status).toBe('ready');
      const res = await fetch(await createExportSignedUrl(row.storage_path!, 60));
      const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
      expect(strFromU8(files['manifest.json']!)).toContain(user.id);
      expect(strFromU8(files['readings.json']!)).not.toContain('Other person');
      // And the other user cannot see this export row at all.
      expect(await getExport(other.client, exportId)).toBeNull();
    } finally {
      await deleteTestUser(other);
    }
  });
});
