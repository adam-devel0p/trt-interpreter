import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAdmin, platformDb } from '@/db/admin';
import { embeddings, retrievalDocuments } from '@/db/schema';
import { seedReferenceData } from '@/db/seed/reference';
import { hashEmbedding, vectorLiteral } from '@/domain/retrieval/hashEmbedding';
import {
  createRlsFixture,
  destroyRlsFixture,
  expectRlsIsolation,
  type RlsFixture,
} from '@/__tests__/rls/harness';

/**
 * Phase 09 tables. Documents and vectors are written by jobs (service role) and are readable
 * and deletable by their owner only — a session cannot insert or rewrite one. Asks follow
 * the standard pattern with a constrained insert. The vector search function runs as the
 * caller: B never sees A's rows, whatever ids B puts in the parameters, and anon sees nothing.
 */
describe('RLS: retrieval documents, embeddings, asks', () => {
  let f: RlsFixture;
  let readingA: string;
  let readingB: string;
  let docA: string;
  let docB: string;
  let journeyA: string;

  beforeAll(async () => {
    await seedReferenceData();
    f = await createRlsFixture();
    const deck = await f.anon.from('decks').select('id').eq('slug', 'rws-classic').single();
    const spread = await f.anon.from('spreads').select('id').eq('slug', 'one-card').single();
    const row = (userId: string, question: string) => ({
      user_id: userId,
      question,
      spread_id: (spread.data as { id: string }).id,
      deck_id: (deck.data as { id: string }).id,
      source: 'physical',
      uses_reversals: false,
    });
    const insertReading = async (u: RlsFixture['a'], q: string) =>
      (
        (await u.client.from('readings').insert(row(u.id, q)).select('id').single()).data as {
          id: string;
        }
      ).id;
    readingA = await insertReading(f.a, 'A asks about Maya');
    readingB = await insertReading(f.b, 'B asks about Maya');
    const db = platformDb();
    const seedDoc = async (userId: string, readingId: string, text: string) => {
      const [d] = await db
        .insert(retrievalDocuments)
        .values({
          userId,
          objectType: 'reading',
          objectId: readingId,
          text,
          builderVersion: 'retrieval_document/1.0.0',
          contentHash: `h-${readingId}`,
        })
        .returning({ id: retrievalDocuments.id });
      await db.insert(embeddings).values({
        userId,
        retrievalDocumentId: d!.id,
        objectType: 'reading',
        objectId: readingId,
        vector: hashEmbedding(text),
        model: 'mock-embed',
        modelVersion: '1',
        contentHash: `h-${readingId}`,
      });
      return d!.id;
    };
    docA = await seedDoc(f.a.id, readingA, 'A asks about Maya. Entities: Maya.');
    docB = await seedDoc(f.b.id, readingB, 'B asks about Maya. Entities: Maya.');
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
    const member = await f.a.client.from('journey_members').insert({
      user_id: f.a.id,
      journey_id: journeyA,
      object_type: 'reading',
      object_id: readingA,
      state: 'confirmed',
      confidence: 1,
      created_by: 'user',
      reasons: [],
    });
    if (member.error) throw new Error(member.error.message);
  });
  afterAll(async () => {
    await destroyRlsFixture(f);
    await closeAdmin();
  });

  for (const table of ['retrieval_documents', 'embeddings'] as const) {
    it(`${table}: owner reads and deletes own rows only; nobody else reads; no session writes`, async () => {
      const idA =
        table === 'retrieval_documents'
          ? docA
          : (
              await platformDb()
                .select({ id: embeddings.id })
                .from(embeddings)
                .where(eq(embeddings.retrievalDocumentId, docA))
            )[0]!.id;
      const own = await f.a.client.from(table).select('id').eq('user_id', f.a.id);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);
      const bRead = await f.b.client.from(table).select('id').eq('id', idA);
      expect(bRead.data ?? []).toHaveLength(0);
      const anonRead = await f.anon.from(table).select('id');
      expect(anonRead.data ?? []).toHaveLength(0);
      // No insert or update policy for sessions.
      const ins = await f.a.client.from(table).insert(
        table === 'retrieval_documents'
          ? {
              user_id: f.a.id,
              object_type: 'reading',
              object_id: readingA,
              text: 'forged',
              builder_version: 'x',
              content_hash: 'y',
            }
          : {
              user_id: f.a.id,
              retrieval_document_id: docA,
              object_type: 'reading',
              object_id: readingA,
              vector: vectorLiteral(hashEmbedding('x')),
              model: 'm',
              model_version: '1',
              content_hash: 'z',
            },
      );
      expect(ins.error).not.toBeNull();
      const upd = await f.a.client
        .from(table)
        .update({ content_hash: 'rewritten' })
        .eq('id', idA)
        .select('id');
      expect(upd.data ?? []).toHaveLength(0);
      const bDel = await f.b.client.from(table).delete().eq('id', idA).select('id');
      expect(bDel.data ?? []).toHaveLength(0);
      const still = await f.a.client.from(table).select('id').eq('id', idA);
      expect(still.data).toHaveLength(1);
    });
  }

  it('asks: standard isolation; a session inserts only a pending, answerless ask', async () => {
    await expectRlsIsolation(
      f,
      'asks',
      (userId) => ({
        user_id: userId,
        question: 'What have I asked about Maya?',
        scope: { kind: 'all' },
        feedback: null,
      }),
      { mutableColumn: 'feedback', mutatedValue: 1 },
    );
    const forged = await f.a.client.from('asks').insert({
      user_id: f.a.id,
      question: 'Forged',
      scope: { kind: 'all' },
      status: 'complete',
      answer: 'x',
    });
    expect(forged.error?.code).toBe('42501');
  });

  it('search_history: B never sees A’s vectors, even with A’s ids in the parameters; anon sees nothing', async () => {
    const vector = vectorLiteral(hashEmbedding('A asks about Maya. Entities: Maya.'));
    const asA = await f.a.client.rpc('search_history', { p: { vector } });
    expect(asA.error).toBeNull();
    expect((asA.data as { object_id: string }[]).map((r) => r.object_id)).toEqual([readingA]);
    expect(Number((asA.data as { similarity: number }[])[0]!.similarity)).toBeCloseTo(1, 3);

    const crafted = await f.b.client.rpc('search_history', {
      p: {
        vector,
        user_id: f.a.id,
        journey_id: journeyA,
        hint_entity_ids: [],
        object_types: ['reading', 'life_event'],
        limit: 400,
      },
    });
    expect(crafted.error).toBeNull();
    expect(crafted.data).toEqual([]);
    const plainB = await f.b.client.rpc('search_history', { p: { vector } });
    expect((plainB.data as { object_id: string }[]).map((r) => r.object_id)).toEqual([readingB]);

    const anon = await f.anon.rpc('search_history', { p: { vector } });
    expect(anon.data ?? []).toEqual([]);
  });

  it('the owner can delete own documents and vectors (the "delete AI artifacts" path)', async () => {
    const del = await f.a.client.from('embeddings').delete().eq('user_id', f.a.id).select('id');
    expect(del.data).toHaveLength(1);
    const delDoc = await f.a.client
      .from('retrieval_documents')
      .delete()
      .eq('id', docA)
      .select('id');
    expect(delDoc.data).toHaveLength(1);
    // B's untouched.
    expect(
      (await f.b.client.from('retrieval_documents').select('id').eq('id', docB)).data,
    ).toHaveLength(1);
  });
});
