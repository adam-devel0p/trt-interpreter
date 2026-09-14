import 'server-only';
import { and, eq } from 'drizzle-orm';
import { platformDb } from '@/db/admin';
import { retrievalDocuments } from '@/db/schema';
import {
  buildRetrievalDocument,
  type DocumentInput,
  type RetrievalDocument,
} from '@/domain/retrieval/document';
import { logger } from '@/observability/logger';
import {
  loadHistoryObjects,
  objectOwner,
  type HistoryObject,
  type HistoryObjectType,
} from './objects';

/**
 * Retrieval documents, the stored side (spec §8.3): build the deterministic text for one
 * object from its current rows and keep exactly one current `retrieval_documents` row per
 * object. An unchanged `content_hash` is a no-op, so the embedding step after it never
 * re-sends an unchanged text. Rebuilt from the write paths that change what the text says —
 * a save or edit, an extraction (and every correction, through the materialiser), a
 * connection decision, an outcome — never by a cron sweep.
 */

export interface RebuildResult {
  status: 'built' | 'unchanged' | 'missing' | 'deleted';
  documentId?: string;
  userId?: string;
  contentHash?: string;
}

/** The pure mapping from a loaded object to the builder's input (unit-tested by snapshot). */
export function toDocumentInput(o: HistoryObject): DocumentInput {
  const outcome = o.outcomes[0]
    ? `${o.outcomes[0].status}${o.outcomes[0].note ? ` — ${o.outcomes[0].note}` : ''}${o.outcomes[0].eventTitle ? ` — ${o.outcomes[0].eventTitle}` : ''}`
    : null;
  const linked = o.links
    .filter((l) => l.state === 'confirmed')
    .map(
      (l) => `${l.otherType === 'reading' ? 'reading' : 'event'} ${l.otherDate} ${l.otherTitle}`,
    );
  return {
    objectType: o.type,
    journeys: o.journeyTitles,
    text: o.title,
    lifeArea: o.lifeAreaLabel,
    eventType: o.eventTypeLabel,
    themes: o.themes,
    deck: o.deckName,
    cards: o.cards.map((c) => ({ name: c.name, orientation: c.orientation })),
    entities: o.entities,
    possibilities: o.possibilities,
    timeframe: o.timeframe,
    outcome,
    linked,
  };
}

export function documentFor(o: HistoryObject): RetrievalDocument {
  return buildRetrievalDocument(toDocumentInput(o));
}

export async function rebuildRetrievalDocument(
  type: HistoryObjectType,
  id: string,
): Promise<RebuildResult> {
  const db = platformDb();
  const owner = await objectOwner(type, id);
  if (!owner) return { status: 'missing' };
  if (owner.deleted) {
    // Out of every view already; the purge (or the cascade trigger) removes the row for good.
    await db
      .delete(retrievalDocuments)
      .where(and(eq(retrievalDocuments.objectType, type), eq(retrievalDocuments.objectId, id)));
    return { status: 'deleted', userId: owner.userId };
  }
  const objects = await loadHistoryObjects(
    owner.userId,
    type === 'reading' ? { readings: [id] } : { events: [id] },
  );
  const object = objects.get(id);
  if (!object) return { status: 'missing' };
  const doc = documentFor(object);

  const [existing] = await db
    .select({ id: retrievalDocuments.id, contentHash: retrievalDocuments.contentHash })
    .from(retrievalDocuments)
    .where(and(eq(retrievalDocuments.objectType, type), eq(retrievalDocuments.objectId, id)))
    .limit(1);
  if (existing && existing.contentHash === doc.contentHash)
    return {
      status: 'unchanged',
      documentId: existing.id,
      userId: owner.userId,
      contentHash: doc.contentHash,
    };

  const now = new Date();
  let documentId: string;
  if (existing) {
    await db
      .update(retrievalDocuments)
      .set({
        text: doc.text,
        contentHash: doc.contentHash,
        builderVersion: doc.builderVersion,
        builtAt: now,
      })
      .where(eq(retrievalDocuments.id, existing.id));
    documentId = existing.id;
  } else {
    const [row] = await db
      .insert(retrievalDocuments)
      .values({
        userId: owner.userId,
        objectType: type,
        objectId: id,
        text: doc.text,
        contentHash: doc.contentHash,
        builderVersion: doc.builderVersion,
        builtAt: now,
      })
      .onConflictDoUpdate({
        target: [retrievalDocuments.objectType, retrievalDocuments.objectId],
        set: {
          text: doc.text,
          contentHash: doc.contentHash,
          builderVersion: doc.builderVersion,
          builtAt: now,
        },
      })
      .returning({ id: retrievalDocuments.id });
    documentId = row!.id;
  }
  logger.info('retrieval.document_built', { userId: owner.userId, objectType: type, objectId: id });
  return { status: 'built', documentId, userId: owner.userId, contentHash: doc.contentHash };
}
