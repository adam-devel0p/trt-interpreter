import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeAdmin,
  createEventMediaSignedUrl,
  eventMediaStoragePath,
  uploadEventMedia,
} from '@/db/admin';
import { getEventMedia } from '@/db/queries/events';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 08 tables. Every row is keyed on `user_id`; child rows additionally require the
 * parent objects to be the caller's, whichever type they are. B cannot confirm a link on A's
 * objects, attach an outcome to A's reading, file A's event in a journey, or reach A's photo;
 * a user session cannot write an INFERRED_EVENT, a model-sourced event, a model-recorded
 * outcome or a rule-created link; signed URLs are minted only after an RLS-checked read.
 */
describe('RLS: life events, outcomes, links', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  let eventA: string;
  let eventB: string;
  let journeyA: string;

  async function insertEvent(user: RlsFixture['a'], description: string): Promise<string> {
    const { data, error } = await user.client
      .from('life_events')
      .insert({ user_id: user.id, description, occurred_on: '2026-09-01' })
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
    eventA = await insertEvent(f.a, 'Mine');
    eventB = await insertEvent(f.b, 'Theirs');
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
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('life_events: own rows only; a session writes only confirmed user events; the words are immutable', async () => {
    await expectRlsIsolation(
      f,
      'life_events',
      (userId) => ({
        user_id: userId,
        description: 'Something happened',
        occurred_on: '2026-09-02',
      }),
      { mutableColumn: 'occurred_on', mutatedValue: '2026-01-01' },
    );
    const inferred = await f.a.client.from('life_events').insert({
      user_id: f.a.id,
      description: 'x',
      occurred_on: '2026-09-02',
      fact_status: 'INFERRED_EVENT',
      confirmed_at: null,
    });
    expect(inferred.error, 'a user session cannot write an INFERRED_EVENT').not.toBeNull();
    const modelSourced = await f.a.client
      .from('life_events')
      .insert({ user_id: f.a.id, description: 'x', occurred_on: '2026-09-02', source: 'model' });
    expect(modelSourced.error, 'a user session cannot write a model-sourced event').not.toBeNull();
    const rewrite = await f.a.client
      .from('life_events')
      .update({ description: 'Rewritten' })
      .eq('id', eventA);
    expect(rewrite.error?.code, 'description is immutable').toBe('23514');
    const demote = await f.a.client
      .from('life_events')
      .update({ fact_status: 'INFERRED_EVENT', confirmed_at: null })
      .eq('id', eventA);
    expect(demote.error, 'a confirmed event cannot be demoted').not.toBeNull();
    const dated = await f.a.client
      .from('life_events')
      .update({ occurred_on: '2026-08-30' })
      .eq('id', eventA)
      .select('id');
    expect(dated.data).toHaveLength(1);
  });

  it('event_media: own rows only, never attached to another user’s event; signed URLs are owner-scoped', async () => {
    await expectRlsIsolation(
      f,
      'event_media',
      (userId) => ({
        user_id: userId,
        life_event_id: userId === f.a.id ? eventA : eventB,
        storage_path: `${userId}/${userId === f.a.id ? eventA : eventB}/p.jpg`,
        mime_type: 'image/jpeg',
        size_bytes: 10,
        alt_text: null,
      }),
      { mutableColumn: 'alt_text', mutatedValue: 'changed' },
    );
    const wrongEvent = await f.b.client.from('event_media').insert({
      user_id: f.b.id,
      life_event_id: eventA,
      storage_path: `${f.b.id}/${eventA}/x.jpg`,
      mime_type: 'image/jpeg',
      size_bytes: 10,
    });
    expect(wrongEvent.error, 'B cannot attach media to A’s event').not.toBeNull();

    // A real object in the private bucket: A reaches it through an RLS-checked row; B gets nothing.
    const path = eventMediaStoragePath(f.a.id, eventA, 'test-media', 'png');
    await uploadEventMedia(path, new Uint8Array([137, 80, 78, 71]), 'image/png');
    const media = await f.a.client
      .from('event_media')
      .insert({
        user_id: f.a.id,
        life_event_id: eventA,
        storage_path: path,
        mime_type: 'image/png',
        size_bytes: 4,
      })
      .select('id')
      .single();
    const mediaId = (media.data as { id: string }).id;
    expect(await getEventMedia(f.a.client, mediaId)).toMatchObject({ storage_path: path });
    expect(await getEventMedia(f.b.client, mediaId)).toBeNull();
    const url = await createEventMediaSignedUrl(path, 60);
    expect(url).toMatch(/token=/);
    // No policies on the bucket: neither user client can read the object directly.
    const direct = await f.b.client.storage.from('event-media').download(path);
    expect(direct.error).not.toBeNull();
    const own = await f.a.client.storage.from('event-media').download(path);
    expect(own.error, 'even the owner goes through the signed URL').not.toBeNull();
  });

  it('outcomes: own rows only, only on own reading and event; user-recorded and confirmed by check', async () => {
    await expectRlsIsolation(
      f,
      'outcomes',
      (userId) => ({
        user_id: userId,
        reading_id: userId === f.a.id ? readingA : readingB,
        status: 'happened',
        note: null,
      }),
      { mutableColumn: 'note', mutatedValue: 'changed' },
    );
    const wrongReading = await f.b.client
      .from('outcomes')
      .insert({ user_id: f.b.id, reading_id: readingA, status: 'happened' });
    expect(wrongReading.error, 'B cannot record an outcome on A’s reading').not.toBeNull();
    const wrongEvent = await f.b.client
      .from('outcomes')
      .insert({ user_id: f.b.id, reading_id: readingB, life_event_id: eventA, status: 'happened' });
    expect(wrongEvent.error, 'B cannot point an outcome at A’s event').not.toBeNull();
    const modelRecorded = await f.a.client
      .from('outcomes')
      .insert({ user_id: f.a.id, reading_id: readingA, status: 'happened', recorded_by: 'model' });
    expect(modelRecorded.error?.code).toBe('23514');
    const inferred = await f.a.client.from('outcomes').insert({
      user_id: f.a.id,
      reading_id: readingA,
      status: 'happened',
      fact_status: 'INFERRED_EVENT',
    });
    expect(inferred.error?.code).toBe('23514');
  });

  it('links: own rows only; B cannot confirm a link on A’s objects; a session creates only user links; state ⇔ user act', async () => {
    const base = (userId: string) => ({
      user_id: userId,
      from_type: 'reading',
      from_id: userId === f.a.id ? readingA : readingB,
      to_type: 'life_event',
      to_id: userId === f.a.id ? eventA : eventB,
      link_type: 'reading_event',
      score: 1,
      reasons: ['You logged this against the reading'],
      created_by: 'user',
      state: 'confirmed',
      user_acted_at: new Date().toISOString(),
      evidence_fingerprint: 'user',
    });
    await expectRlsIsolation(f, 'links', base, {
      mutableColumn: 'state',
      mutatedValue: 'rejected',
    });
    const crossFrom = await f.b.client.from('links').insert({ ...base(f.b.id), from_id: readingA });
    expect(crossFrom.error, 'B cannot link from A’s reading').not.toBeNull();
    const crossTo = await f.b.client.from('links').insert({ ...base(f.b.id), to_id: eventA });
    expect(crossTo.error, 'B cannot link to A’s event').not.toBeNull();
    const ruleRow = await f.a.client
      .from('links')
      .insert({ ...base(f.a.id), created_by: 'rule', state: 'pending', user_acted_at: null });
    expect(ruleRow.error, 'a session cannot create a rule link').not.toBeNull();
    const modelRow = await f.a.client
      .from('links')
      .insert({ ...base(f.a.id), created_by: 'model' });
    expect(modelRow.error, 'never a model link (policy and check both refuse)').not.toBeNull();
    const unacted = await f.a.client.from('links').insert({ ...base(f.a.id), user_acted_at: null });
    expect(unacted.error?.code, 'a confirmed state needs a user act').toBe('23514');
    const pendingActed = await f.a.client
      .from('links')
      .insert({ ...base(f.a.id), state: 'pending' });
    expect(pendingActed.error?.code, 'a pending row carries no user act').toBe('23514');

    // A rule-created row (service role) on A's objects: B cannot decide it, A can.
    const { platformDb } = await import('@/db/admin');
    const { links } = await import('@/db/schema');
    const [rule] = await platformDb()
      .insert(links)
      .values({
        userId: f.a.id,
        fromType: 'reading',
        fromId: readingA,
        toType: 'life_event',
        toId: eventA,
        linkType: 'reading_event',
        score: '0.800',
        reasons: ['Both mention the agency'],
        createdBy: 'rule',
        state: 'pending',
        evidenceFingerprint: 'abc',
        offeredAt: new Date(),
      })
      .returning({ id: links.id });
    const bConfirm = await f.b.client
      .from('links')
      .update({ state: 'confirmed', user_acted_at: new Date().toISOString() })
      .eq('id', rule!.id)
      .select('id');
    expect(bConfirm.data ?? []).toHaveLength(0);
    const aConfirm = await f.a.client
      .from('links')
      .update({ state: 'confirmed', user_acted_at: new Date().toISOString() })
      .eq('id', rule!.id)
      .select('id, state');
    expect(aConfirm.data).toEqual([{ id: rule!.id, state: 'confirmed' }]);
  });

  it('journey_members: a life event member must be the caller’s event', async () => {
    const mine = await f.a.client.from('journey_members').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      object_type: 'life_event',
      object_id: eventA,
      confidence: 1,
      created_by: 'user',
      state: 'confirmed',
    });
    expect(mine.error).toBeNull();
    const theirs = await f.a.client.from('journey_members').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      object_type: 'life_event',
      object_id: eventB,
      confidence: 1,
      created_by: 'user',
      state: 'confirmed',
    });
    expect(theirs.error, 'A cannot file B’s event').not.toBeNull();
    // The same tightening applies to the derived tables keyed by (object_type, object_id).
    const theme = await f.a.client
      .from('themes')
      .select('id')
      .is('user_id', null)
      .limit(1)
      .single();
    const themeOnTheirs = await f.a.client.from('object_themes').insert({
      user_id: f.a.id,
      object_type: 'life_event',
      object_id: eventB,
      theme_id: (theme.data as { id: string }).id,
      weight: 0.5,
      source: 'user',
      user_confirmed: true,
    });
    expect(themeOnTheirs.error, 'A cannot attach a theme to B’s event').not.toBeNull();
  });
});
