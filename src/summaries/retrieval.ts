import 'server-only';
import { and, eq } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { periodSummaries, retrievalDocuments } from '@/db/schema';
import { buildRetrievalDocument } from '@/domain/retrieval/document';
import { periodLabel } from '@/domain/summaries/periods';
import { SUMMARY_SECTIONS, type StoredHighlights } from '@/domain/summaries/schema';
import { embedDocument } from '@/retrieval/embed';

/**
 * Compaction (spec §8.1 step 4, Phase 09 notes): a stored summary gets a retrieval document
 * (`object_type = 'period_summary'`) and a vector like any object, so it is a retrieval-
 * eligible object that can travel with an Ask package as compression of the entries it
 * covers — never in their place and never as the sole support for a real-life claim
 * (`domain/retrieval/answer.ts` drops a claim that cites only summaries). The text is the
 * headline plus the claim texts: generated prose, no notes, no user text.
 */
export async function storeSummaryDocument(
  summaryId: string,
): Promise<{ status: 'built' | 'unchanged' | 'missing'; embedding?: string }> {
  const db = platformDb();
  const [row] = await db
    .select()
    .from(periodSummaries)
    .where(eq(periodSummaries.id, summaryId))
    .limit(1);
  if (!row) return { status: 'missing' };
  const highlights = row.highlights as StoredHighlights;
  const claims = SUMMARY_SECTIONS.flatMap((s) => highlights[s]?.map((c) => c.text) ?? []);
  const doc = buildRetrievalDocument({
    objectType: 'period_summary',
    journeys: [],
    text: `${row.kind === 'journey' ? 'Journey summary' : periodLabel({ kind: row.kind as 'weekly' | 'monthly' | 'yearly', start: row.periodStart })}: ${row.summary}`,
    lifeArea: null,
    themes: [],
    entities: [],
    highlights: claims,
  });
  const [existing] = await db
    .select({ id: retrievalDocuments.id, contentHash: retrievalDocuments.contentHash })
    .from(retrievalDocuments)
    .where(
      and(
        eq(retrievalDocuments.objectType, 'period_summary'),
        eq(retrievalDocuments.objectId, summaryId),
      ),
    )
    .limit(1);
  let documentId: string;
  let status: 'built' | 'unchanged' = 'built';
  if (existing && existing.contentHash === doc.contentHash) {
    documentId = existing.id;
    status = 'unchanged';
  } else if (existing) {
    await db
      .update(retrievalDocuments)
      .set({
        text: doc.text,
        contentHash: doc.contentHash,
        builderVersion: doc.builderVersion,
        builtAt: new Date(),
      })
      .where(eq(retrievalDocuments.id, existing.id));
    documentId = existing.id;
  } else {
    const [inserted] = await db
      .insert(retrievalDocuments)
      .values({
        userId: row.userId,
        objectType: 'period_summary',
        objectId: summaryId,
        text: doc.text,
        contentHash: doc.contentHash,
        builderVersion: doc.builderVersion,
      })
      .returning({ id: retrievalDocuments.id });
    documentId = inserted!.id;
  }
  const emb = await embedDocument(documentId);
  return { status, embedding: emb.status };
}
