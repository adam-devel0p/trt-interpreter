import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, insertAiCall, platformSql } from '@/db/admin';
import { seedReferenceData } from '@/db/seed/reference';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectNoUserAccess,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 04 tables. `interpretations`, `safety_flags` and `question_embeddings` are user-owned:
 * standard four-policy isolation, and an interpretation can never be attached to someone
 * else's reading even with the caller's own user_id. `ai_calls` is service-role only.
 */
describe('RLS: interpretations, safety_flags, question_embeddings, ai_calls', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'rws-classic').single();
    const spread = await f.anon.from('spreads').select('id').eq('slug', 'one-card').single();
    const row = (userId: string) => ({
      user_id: userId,
      question: 'Whose?',
      spread_id: (spread.data as { id: string }).id,
      deck_id: (deck.data as { id: string }).id,
      source: 'physical',
      uses_reversals: true,
    });
    const a = await f.a.client.from('readings').insert(row(f.a.id)).select('id').single();
    const b = await f.b.client.from('readings').insert(row(f.b.id)).select('id').single();
    readingA = (a.data as { id: string }).id;
    readingB = (b.data as { id: string }).id;
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  const interpretationRow = (userId: string) => ({
    user_id: userId,
    reading_id: userId === f.a.id ? readingA : readingB,
    metadata_version: 1,
    depth: 'standard',
    prompt_version: 'p',
    schema_version: 's',
  });

  it('interpretations: isolation, and B cannot attach a row to A’s reading with their own user_id', async () => {
    await expectRlsIsolation(f, 'interpretations', interpretationRow, {
      mutableColumn: 'depth',
      mutatedValue: 'deep',
    });
    const spoof = await f.b.client
      .from('interpretations')
      .insert({ ...interpretationRow(f.b.id), reading_id: readingA })
      .select('id');
    expect(spoof.error).not.toBeNull();
    expect(spoof.data ?? []).toHaveLength(0);
    // Nor re-point their own row at A's reading.
    const own = await f.b.client
      .from('interpretations')
      .insert(interpretationRow(f.b.id))
      .select('id')
      .single();
    const repoint = await f.b.client
      .from('interpretations')
      .update({ reading_id: readingA })
      .eq('id', (own.data as { id: string }).id)
      .select('id');
    expect(repoint.error ?? repoint.data?.length === 0).toBeTruthy();
  });

  it('safety_flags: standard isolation', async () => {
    await expectRlsIsolation(
      f,
      'safety_flags',
      (userId) => ({
        user_id: userId,
        object_type: 'reading',
        object_id: userId === f.a.id ? readingA : readingB,
        category: 'medical',
        severity: 'medium',
      }),
      { mutableColumn: 'severity', mutatedValue: 'high' },
    );
  });

  it('question_embeddings: standard isolation; B cannot link their ask to A’s reading', async () => {
    const vector = JSON.stringify(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    await expectRlsIsolation(
      f,
      'question_embeddings',
      (userId) => ({ user_id: userId, question_hash: 'abc', vector, model: 'mock' }),
      { mutableColumn: 'question_hash', mutatedValue: 'zzz' },
    );
    const own = await f.b.client
      .from('question_embeddings')
      .insert({ user_id: f.b.id, question_hash: 'b', vector, model: 'mock' })
      .select('id')
      .single();
    const link = await f.b.client
      .from('question_embeddings')
      .update({ reading_id: readingA })
      .eq('id', (own.data as { id: string }).id)
      .select('id');
    expect(link.error ?? link.data?.length === 0).toBeTruthy();
  });

  it('ai_calls: invisible and unwritable to users and anon; the service role writes', async () => {
    await insertAiCall({
      userId: f.a.id,
      task: 'classify_safety',
      modelId: 'mock',
      promptVersion: 'p',
      schemaVersion: 's',
      tokensIn: 1,
      tokensOut: 1,
      costMicros: 0,
      latencyMs: 1,
      status: 'ok',
      errorClass: null,
      attempts: 1,
      objectRefs: [{ type: 'reading', id: readingA }],
    });
    await expectNoUserAccess(f, 'ai_calls', {
      user_id: f.a.id,
      task: 'classify_safety',
      model_id: 'mock',
      status: 'ok',
    });
    const [row] = await platformSql()<
      { n: number }[]
    >`select count(*)::int as n from public.ai_calls where user_id = ${f.a.id}`;
    expect(row?.n).toBe(1);
  });
});
