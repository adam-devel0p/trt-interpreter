import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformSql } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 06 tables and functions. Every structured-memory table is keyed on `user_id`; child
 * rows additionally require the parent reading / entity to be the caller's. `extractions` is
 * read + delete only (the job writes it); `themes` mixes public curated rows with user rows.
 * The merge / undo / split functions run as the caller and refuse other users' entities.
 */
describe('RLS: structured memory', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  let entityA: string;
  let entityB: string;
  let globalTheme: string;

  async function insertEntity(user: RlsFixture['a'], label: string): Promise<string> {
    const { data, error } = await user.client
      .from('entities')
      .insert({ user_id: user.id, kind: 'person', canonical_label: label })
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
    entityA = await insertEntity(f.a, 'Alex');
    entityB = await insertEntity(f.b, 'Alex');
    globalTheme = (
      (await f.a.client.from('themes').select('id').is('user_id', null).limit(1).single()).data as {
        id: string;
      }
    ).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  it('entities', async () => {
    await expectRlsIsolation(
      f,
      'entities',
      (userId) => ({ user_id: userId, kind: 'place', canonical_label: 'Leeds' }),
      { mutableColumn: 'canonical_label', mutatedValue: 'Not Leeds' },
    );
  });

  it('entity_aliases: own rows only, and never attached to another user’s entity', async () => {
    await expectRlsIsolation(
      f,
      'entity_aliases',
      (userId) => ({
        user_id: userId,
        entity_id: userId === f.a.id ? entityA : entityB,
        alias: 'Al',
        alias_normalized: 'al',
        confidence: 1,
        source: 'user',
      }),
      { mutableColumn: 'alias', mutatedValue: 'Bob' },
    );
    const spoof = await f.b.client.from('entity_aliases').insert({
      user_id: f.b.id,
      entity_id: entityA,
      alias: 'x',
      alias_normalized: 'x',
      confidence: 1,
      source: 'user',
    });
    expect(spoof.error).not.toBeNull();
  });

  it('entity_roles: own rows only, parent must be own; a role is never rewritten', async () => {
    await expectRlsIsolation(
      f,
      'entity_roles',
      (userId) => ({
        user_id: userId,
        entity_id: userId === f.a.id ? entityA : entityB,
        role: 'friend',
        valid_from: '2026-01-01',
        valid_to: null,
        source: 'user',
      }),
      { mutableColumn: 'valid_to', mutatedValue: '2026-02-01' },
    );
    const spoof = await f.b.client.from('entity_roles').insert({
      user_id: f.b.id,
      entity_id: entityA,
      role: 'friend',
      valid_from: '2026-01-01',
      source: 'user',
    });
    expect(spoof.error).not.toBeNull();
  });

  it('entity_mentions: own rows only, both parents must be own', async () => {
    await expectRlsIsolation(
      f,
      'entity_mentions',
      (userId) => ({
        user_id: userId,
        entity_id: userId === f.a.id ? entityA : entityB,
        object_type: 'reading',
        object_id: userId === f.a.id ? readingA : readingB,
        mention_text: 'Alex',
        mention_normalized: 'alex',
        confidence: 0.9,
        resolution: 'user',
      }),
      { mutableColumn: 'mention_text', mutatedValue: 'Bob' },
    );
    const base = {
      user_id: f.b.id,
      mention_text: 'Alex',
      mention_normalized: 'alex2',
      confidence: 0.9,
      resolution: 'user',
      object_type: 'reading',
    };
    const wrongEntity = await f.b.client
      .from('entity_mentions')
      .insert({ ...base, entity_id: entityA, object_id: readingB });
    expect(wrongEntity.error).not.toBeNull();
    const wrongReading = await f.b.client
      .from('entity_mentions')
      .insert({ ...base, entity_id: entityB, object_id: readingA });
    expect(wrongReading.error).not.toBeNull();
  });

  it('entity_merges', async () => {
    await expectRlsIsolation(
      f,
      'entity_merges',
      (userId) => ({
        user_id: userId,
        source_entity_id: userId === f.a.id ? entityA : entityB,
        target_entity_id: userId === f.a.id ? entityA : entityB,
        snapshot: {},
        undone_at: null,
      }),
      { mutableColumn: 'undone_at', mutatedValue: '2026-01-01T00:00:00Z' },
    );
  });

  it('extractions: job-written; owner reads and deletes, nobody inserts or updates, others see nothing', async () => {
    const rows = await platformSql()<{ id: string }[]>`
      insert into public.extractions (user_id, object_type, object_id, status, schema_version, prompt_version, metadata_version, source_hash, payload, model_id)
      values (${f.a.id}, 'reading', ${readingA}, 'complete', 's/1', 'p/1', 1, 'h', '{}'::jsonb, 'mock/x')
      returning id`;
    const id = rows[0]!.id;
    const own = await f.a.client.from('extractions').select('id').eq('id', id);
    expect(own.data).toHaveLength(1);
    expect(
      (await f.b.client.from('extractions').select('id').eq('id', id)).data ?? [],
    ).toHaveLength(0);
    expect((await f.anon.from('extractions').select('id')).data ?? []).toHaveLength(0);
    const ins = await f.a.client.from('extractions').insert({
      user_id: f.a.id,
      object_type: 'reading',
      object_id: readingA,
      status: 'pending',
      schema_version: 's',
      prompt_version: 'p',
      metadata_version: 1,
      source_hash: 'h',
    });
    expect(ins.error).not.toBeNull();
    const upd = await f.a.client
      .from('extractions')
      .update({ status: 'failed' })
      .eq('id', id)
      .select('id');
    expect(upd.data ?? []).toHaveLength(0);
    const bDel = await f.b.client.from('extractions').delete().eq('id', id).select('id');
    expect(bDel.data ?? []).toHaveLength(0);
    const aDel = await f.a.client.from('extractions').delete().eq('id', id).select('id');
    expect(aDel.data).toHaveLength(1);
  });

  it('metadata_overrides: own rows, on own readings only', async () => {
    await expectRlsIsolation(
      f,
      'metadata_overrides',
      (userId) => ({
        user_id: userId,
        object_type: 'reading',
        object_id: userId === f.a.id ? readingA : readingB,
        field_path: 'life_area',
        value: { kind: 'life_area', value: 'work' },
      }),
      { mutableColumn: 'value', mutatedValue: { kind: 'life_area', value: 'money' } },
    );
    const spoof = await f.b.client.from('metadata_overrides').insert({
      user_id: f.b.id,
      object_type: 'reading',
      object_id: readingA,
      field_path: 'life_area',
      value: { kind: 'life_area', value: 'work' },
    });
    expect(spoof.error).not.toBeNull();
  });

  it('themes: curated rows readable by all authenticated users, writable by nobody; user rows isolated', async () => {
    expect(globalTheme).toBeTruthy();
    expect((await f.b.client.from('themes').select('id').eq('id', globalTheme)).data).toHaveLength(
      1,
    );
    const upd = await f.a.client
      .from('themes')
      .update({ label: 'x' })
      .eq('id', globalTheme)
      .select('id');
    expect(upd.data ?? []).toHaveLength(0);
    const del = await f.a.client.from('themes').delete().eq('id', globalTheme).select('id');
    expect(del.data ?? []).toHaveLength(0);
    const spoofGlobal = await f.a.client
      .from('themes')
      .insert({ user_id: null, slug: 'spoofed', label: 'Spoofed', category: 'situational' });
    expect(spoofGlobal.error).not.toBeNull();
    await expectRlsIsolation(
      f,
      'themes',
      (userId) => ({
        user_id: userId,
        slug: 'paperwork',
        label: 'Paperwork',
        category: 'practical',
      }),
      { mutableColumn: 'label', mutatedValue: 'Other', hasPublicRows: true },
    );
  });

  it('object_themes: own rows, on own readings only', async () => {
    await expectRlsIsolation(
      f,
      'object_themes',
      (userId) => ({
        user_id: userId,
        object_type: 'reading',
        object_id: userId === f.a.id ? readingA : readingB,
        theme_id: globalTheme,
        weight: 0.5,
        source: 'user',
        user_confirmed: true,
      }),
      { mutableColumn: 'weight', mutatedValue: 0.1 },
    );
    const spoof = await f.b.client.from('object_themes').insert({
      user_id: f.b.id,
      object_type: 'reading',
      object_id: readingA,
      theme_id: globalTheme,
      weight: 0.5,
      source: 'user',
    });
    expect(spoof.error).not.toBeNull();
  });

  it('predictions: own rows, on own readings only; fact_status fixed by check', async () => {
    await expectRlsIsolation(
      f,
      'predictions',
      (userId) => ({
        user_id: userId,
        reading_id: userId === f.a.id ? readingA : readingB,
        text: 'The offer may come through.',
        text_hash: 'abc',
      }),
      { mutableColumn: 'text', mutatedValue: 'changed' },
    );
    const spoof = await f.b.client
      .from('predictions')
      .insert({ user_id: f.b.id, reading_id: readingA, text: 'x', text_hash: 'x' });
    expect(spoof.error).not.toBeNull();
    const fact = await f.a.client.from('predictions').insert({
      user_id: f.a.id,
      reading_id: readingA,
      text: 'x',
      text_hash: 'fact',
      fact_status: 'CONFIRMED_FACT',
    });
    expect(fact.error?.code).toBe('23514');
  });

  it('merge / undo / split functions refuse another user’s entities and anon', async () => {
    const plan = {
      move_aliases: [],
      drop_aliases: [],
      move_mentions: [],
      drop_mentions: [],
      move_roles: [],
      drop_roles: [],
    };
    const cross = await f.b.client.rpc('apply_entity_merge', {
      p_source: entityA,
      p_target: entityB,
      p_plan: plan,
    });
    expect(cross.error?.code).toBe('P0002');
    const anon = await f.anon.rpc('apply_entity_merge', {
      p_source: entityA,
      p_target: entityB,
      p_plan: plan,
    });
    expect(anon.error?.code).toBe('42501');
    const split = await f.b.client.rpc('apply_entity_split', {
      p_source: entityA,
      p_label: 'x',
      p_kind: 'person',
      p_plan: {
        move_mentions: ['00000000-0000-4000-8000-000000000001'],
        move_aliases: [],
        copy_aliases: [],
      },
    });
    expect(split.error?.code).toBe('P0002');
    // A legitimate merge by the owner, then B cannot undo it.
    const other = await insertEntity(f.a, 'Alexandra');
    const ok = await f.a.client.rpc('apply_entity_merge', {
      p_source: other,
      p_target: entityA,
      p_plan: plan,
    });
    expect(ok.error).toBeNull();
    const undo = await f.b.client.rpc('undo_entity_merge', { p_merge: ok.data as string });
    expect(undo.error?.code).toBe('P0002');
    expect(
      (await f.a.client.rpc('undo_entity_merge', { p_merge: ok.data as string })).error,
    ).toBeNull();
  });

  it('search_readings entity filter only ever returns the caller’s rows', async () => {
    await f.a.client.from('entity_mentions').insert({
      user_id: f.a.id,
      entity_id: entityA,
      object_type: 'reading',
      object_id: readingA,
      mention_text: 'Alex',
      mention_normalized: 'alex-filter',
      confidence: 1,
      resolution: 'user',
    });
    const mine = await f.a.client.rpc('search_readings', { p: { entity_id: entityA } });
    expect((mine.data as { id: string }[]).map((r) => r.id)).toEqual([readingA]);
    const theirs = await f.b.client.rpc('search_readings', { p: { entity_id: entityA } });
    expect(theirs.data).toEqual([]);
  });
});
