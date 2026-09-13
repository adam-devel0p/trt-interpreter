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
 * Phase 07 tables and functions. Every journey table is keyed on `user_id`; members and
 * progression steps additionally require the parent journey (and, for a reading member,
 * the reading) to be the caller's. B cannot add a member to A's journey nor read A's
 * progression; the merge / undo / split functions run as the caller and refuse other
 * users' journeys; the journal's journey filter returns only the caller's rows.
 */
describe('RLS: journeys', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  let journeyA: string;
  let journeyB: string;
  let themeId: string;

  async function insertJourney(user: RlsFixture['a'], title: string): Promise<string> {
    const { data, error } = await user.client
      .from('journeys')
      .insert({ user_id: user.id, title, status: 'active', confidence: 1, created_by: 'user' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'rws-classic').single();
    const spread = await f.anon.from('spreads').select('id').eq('slug', 'one-card').single();
    const row = (userId: string) => ({
      user_id: userId,
      question: 'A question',
      spread_id: (spread.data as { id: string }).id,
      deck_id: (deck.data as { id: string }).id,
      source: 'physical',
      uses_reversals: false,
    });
    readingA = (
      (await f.a.client.from('readings').insert(row(f.a.id)).select('id').single()).data as {
        id: string;
      }
    ).id;
    readingB = (
      (await f.b.client.from('readings').insert(row(f.b.id)).select('id').single()).data as {
        id: string;
      }
    ).id;
    journeyA = await insertJourney(f.a, 'Mine');
    journeyB = await insertJourney(f.b, 'Theirs');
    themeId = (
      (await f.a.client.from('themes').select('id').is('user_id', null).limit(1).single()).data as {
        id: string;
      }
    ).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('journeys', async () => {
    await expectRlsIsolation(
      f,
      'journeys',
      (userId) => ({
        user_id: userId,
        title: 'Leeds',
        status: 'suggested',
        confidence: 0.7,
        created_by: 'rule',
      }),
      { mutableColumn: 'title', mutatedValue: 'Not Leeds' },
    );
  });

  it('journey_members: own rows only; never attached to another user’s journey or reading', async () => {
    await expectRlsIsolation(
      f,
      'journey_members',
      (userId) => ({
        user_id: userId,
        journey_id: userId === f.a.id ? journeyA : journeyB,
        object_type: 'reading',
        object_id: userId === f.a.id ? readingA : readingB,
        confidence: 0.8,
        created_by: 'user',
        state: 'confirmed',
      }),
      { mutableColumn: 'state', mutatedValue: 'removed' },
    );
    const base = {
      user_id: f.b.id,
      object_type: 'reading',
      confidence: 0.8,
      created_by: 'user',
      state: 'confirmed',
    };
    const wrongJourney = await f.b.client
      .from('journey_members')
      .insert({ ...base, journey_id: journeyA, object_id: readingB });
    expect(wrongJourney.error, 'B cannot add a member to A’s journey').not.toBeNull();
    const wrongReading = await f.b.client
      .from('journey_members')
      .insert({ ...base, journey_id: journeyB, object_id: readingA });
    expect(wrongReading.error, 'B cannot file A’s reading').not.toBeNull();
    const badState = await f.a.client.from('journey_members').insert({
      ...base,
      user_id: f.a.id,
      journey_id: journeyA,
      object_id: readingA,
      state: 'maybe',
    });
    expect(badState.error?.code).toBe('23514');
  });

  it('journey_theme_progression: own rows only, parent must be own, evidence required', async () => {
    await expectRlsIsolation(
      f,
      'journey_theme_progression',
      (userId) => ({
        user_id: userId,
        journey_id: userId === f.a.id ? journeyA : journeyB,
        sequence_index: 0,
        theme_id: themeId,
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        source_object_ids: [userId === f.a.id ? readingA : readingB],
      }),
      { mutableColumn: 'period_end', mutatedValue: '2026-04-30' },
    );
    const spoof = await f.b.client.from('journey_theme_progression').insert({
      user_id: f.b.id,
      journey_id: journeyA,
      sequence_index: 5,
      theme_id: themeId,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      source_object_ids: [readingB],
    });
    expect(spoof.error, 'B cannot write A’s progression').not.toBeNull();
    const bRead = await f.b.client
      .from('journey_theme_progression')
      .select('id')
      .eq('journey_id', journeyA);
    expect(bRead.data).toEqual([]);
    const empty = await f.a.client.from('journey_theme_progression').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      sequence_index: 7,
      theme_id: themeId,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      source_object_ids: [],
    });
    expect(empty.error?.code, 'a step without evidence is not representable').toBe('23514');
  });

  it('merge / undo / split refuse another user’s journeys and anon', async () => {
    const other = await insertJourney(f.a, 'Other');
    const merge = await f.b.client.rpc('apply_journey_merge', {
      p_source: journeyA,
      p_target: other,
    });
    expect(merge.error?.code).toBe('P0002');
    const undo = await f.b.client.rpc('undo_journey_merge', { p_source: journeyA });
    expect(undo.error?.code).toBe('P0002');
    const split = await f.b.client.rpc('apply_journey_split', {
      p_source: journeyA,
      p_title: 'x',
      p_member_ids: [],
    });
    expect(split.error?.code).toBe('P0002');
    const anon = await f.anon.rpc('apply_journey_merge', { p_source: journeyA, p_target: other });
    expect(anon.error).not.toBeNull();
    // As A: the merge works and undo restores it.
    const ok = await f.a.client.rpc('apply_journey_merge', { p_source: other, p_target: journeyA });
    expect(ok.error).toBeNull();
    const merged = await f.a.client
      .from('journeys')
      .select('status, merged_into_id')
      .eq('id', other)
      .single();
    expect(merged.data).toEqual({ status: 'closed', merged_into_id: journeyA });
    const back = await f.a.client.rpc('undo_journey_merge', { p_source: other });
    expect(back.error).toBeNull();
    const restored = await f.a.client
      .from('journeys')
      .select('status, merged_into_id')
      .eq('id', other)
      .single();
    expect(restored.data).toEqual({ status: 'active', merged_into_id: null });
  });

  it('search_readings(journey_id) returns only the caller’s rows', async () => {
    await f.a.client.from('journey_members').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      object_type: 'reading',
      object_id: readingA,
      confidence: 1,
      created_by: 'user',
      state: 'confirmed',
    });
    const mine = await f.a.client
      .rpc('search_readings', { p: { journey_id: journeyA, limit: 10 } })
      .select('id');
    expect((mine.data as { id: string }[]).map((r) => r.id)).toEqual([readingA]);
    const theirs = await f.b.client
      .rpc('search_readings', { p: { journey_id: journeyA, limit: 10 } })
      .select('id');
    expect(theirs.data).toEqual([]);
  });
});
