import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformDb } from '@/db/admin';
import { journeyNarratives, periodSummaries } from '@/db/schema';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 10 tables. Summaries and narratives are written by jobs (service role): the owner
 * reads and deletes them, may dismiss a summary and nothing else (the `period_summaries_protect`
 * trigger refuses a rewrite of the text, sources or provenance), and B / anon see nothing —
 * B cannot read A's summaries. Retention prompts and reminder settings are the session's own
 * rows on the standard pattern.
 */
describe('RLS: period summaries, journey narratives, retention prompts', () => {
  let f: RlsFixture;
  let journeyA: string;
  let summaryA: string;
  let narrativeA: string;

  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    journeyA = (
      (
        await f.a.client
          .from('journeys')
          .insert({
            user_id: f.a.id,
            title: 'Mine',
            status: 'active',
            confidence: 1,
            created_by: 'user',
          })
          .select('id')
          .single()
      ).data as { id: string }
    ).id;
    const db = platformDb();
    const fakeSource = '11111111-1111-4111-8111-111111111111';
    summaryA = (
      await db
        .insert(periodSummaries)
        .values({
          userId: f.a.id,
          scope: 'user',
          kind: 'monthly',
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          summary: 'August, in a sentence.',
          highlights: { recurred: [], shifted: [], open: [], confirmed: [] },
          sourceObjectIds: [fakeSource],
          sources: [{ type: 'reading', id: fakeSource }],
          objectCount: 5,
          inputHash: 'h',
          modelId: 'mock/x',
          promptVersion: 'summarize_period/1.0.0',
          schemaVersion: 'period_summary/1.0.0',
        })
        .returning({ id: periodSummaries.id })
    )[0]!.id;
    narrativeA = (
      await db
        .insert(journeyNarratives)
        .values({
          userId: f.a.id,
          journeyId: journeyA,
          sentence: 'Your readings moved.',
          progression: ['a', 'b'],
          sourceObjectIds: [fakeSource],
          sources: [{ type: 'reading', id: fakeSource }],
          fingerprint: 'fp',
          objectCount: 3,
          modelId: 'mock/x',
          promptVersion: 'journey_narrative/1.0.0',
          schemaVersion: 'journey_narrative/1.0.0',
        })
        .returning({ id: journeyNarratives.id })
    )[0]!.id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('period_summaries: owner reads, dismisses and deletes own; B cannot read, dismiss or delete A’s; no session insert or rewrite', async () => {
    const own = await f.a.client.from('period_summaries').select('id, summary').eq('id', summaryA);
    expect(own.data).toHaveLength(1);
    expect(
      (await f.b.client.from('period_summaries').select('id').eq('id', summaryA)).data ?? [],
    ).toHaveLength(0);
    expect((await f.b.client.from('period_summaries').select('id')).data ?? []).toHaveLength(0);
    expect((await f.anon.from('period_summaries').select('id')).data ?? []).toHaveLength(0);
    // Dismiss is the owner's; the text is not.
    const dismiss = await f.a.client
      .from('period_summaries')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', summaryA)
      .select('id, dismissed_at');
    expect(dismiss.error).toBeNull();
    expect((dismiss.data as { dismissed_at: string }[])[0]!.dismissed_at).not.toBeNull();
    const rewrite = await f.a.client
      .from('period_summaries')
      .update({ summary: 'Forged.' })
      .eq('id', summaryA);
    expect(rewrite.error?.code).toBe('42501');
    const bDismiss = await f.b.client
      .from('period_summaries')
      .update({ dismissed_at: null })
      .eq('id', summaryA)
      .select('id');
    expect(bDismiss.data ?? []).toHaveLength(0);
    const ins = await f.a.client.from('period_summaries').insert({
      user_id: f.a.id,
      scope: 'user',
      kind: 'weekly',
      period_start: '2026-08-03',
      period_end: '2026-08-09',
      summary: 'forged',
      highlights: {},
      source_object_ids: ['11111111-1111-4111-8111-111111111111'],
      sources: [],
      object_count: 3,
      input_hash: 'x',
      model_id: 'm',
      prompt_version: 'p',
      schema_version: 's',
    });
    expect(ins.error).not.toBeNull();
    expect(
      (await f.b.client.from('period_summaries').delete().eq('id', summaryA).select('id')).data ??
        [],
    ).toHaveLength(0);
    expect(
      (await f.a.client.from('period_summaries').select('id').eq('id', summaryA)).data,
    ).toHaveLength(1);
    const del = await f.a.client.from('period_summaries').delete().eq('id', summaryA).select('id');
    expect(del.data).toHaveLength(1);
  });

  it('journey_narratives: owner reads and deletes own only; nobody else reads; no session writes', async () => {
    expect(
      (await f.a.client.from('journey_narratives').select('id').eq('journey_id', journeyA)).data,
    ).toHaveLength(1);
    expect(
      (await f.b.client.from('journey_narratives').select('id').eq('id', narrativeA)).data ?? [],
    ).toHaveLength(0);
    expect((await f.anon.from('journey_narratives').select('id')).data ?? []).toHaveLength(0);
    const upd = await f.a.client
      .from('journey_narratives')
      .update({ sentence: 'x' })
      .eq('id', narrativeA)
      .select('id');
    expect(upd.data ?? []).toHaveLength(0);
    const ins = await f.a.client.from('journey_narratives').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      sentence: 'forged',
      progression: [],
      source_object_ids: ['11111111-1111-4111-8111-111111111111'],
      sources: [],
      fingerprint: 'f',
      object_count: 3,
      model_id: 'm',
      prompt_version: 'p',
      schema_version: 's',
    });
    expect(ins.error).not.toBeNull();
    expect(
      (await f.b.client.from('journey_narratives').delete().eq('id', narrativeA).select('id'))
        .data ?? [],
    ).toHaveLength(0);
    expect(
      (await f.a.client.from('journey_narratives').delete().eq('id', narrativeA).select('id')).data,
    ).toHaveLength(1);
  });

  it('retention_prompts: standard isolation', async () => {
    await expectRlsIsolation(
      f,
      'retention_prompts',
      (userId) => ({
        user_id: userId,
        kind: 'on_this_day',
        fingerprint: `fp-${userId}`,
        object_type: 'reading',
        object_id: null,
        payload: {},
        shown_on: '2026-09-14',
        dismissed_at: null,
      }),
      { mutableColumn: 'shown_on', mutatedValue: '2020-01-01' },
    );
  });
});
