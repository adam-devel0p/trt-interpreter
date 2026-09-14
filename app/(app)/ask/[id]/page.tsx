import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getAsk, type AskCitation } from '@/db/queries/asks';
import { loadHistoryObjects } from '@/retrieval/objects';
import type { AskEvidenceCard } from '@/retrieval/ask';
import { FormMessage } from '@/ui/components/field';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import { AnswerView } from '../answer-view';
import { AskFeedback } from '../ask-feedback';

export const metadata = { title: 'Ask my history' };
export const dynamic = 'force-dynamic';

/**
 * A stored ask (spec §6.6): the answer and its evidence exactly as they were verified, with
 * the cited entries re-read from the journal so a deleted one simply disappears. Opening it
 * makes no model call.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  const client = await getSessionClient();
  const ask = await getAsk(client, id);
  if (!ask) notFound();

  const citations = ask.citations ?? [];
  const objects = await loadHistoryObjects(user.id, {
    readings: citations.filter((c) => c.object_type === 'reading').map((c) => c.object_id),
    events: citations.filter((c) => c.object_type === 'life_event').map((c) => c.object_id),
  });
  const claims = ask.claims ?? [];
  const evidence: AskEvidenceCard[] = citations
    .map((c: AskCitation) => {
      const o = objects.get(c.object_id);
      if (!o) return null;
      return {
        label: c.label,
        type: o.type,
        id: o.id,
        date: o.date,
        title: o.title,
        deck: o.deckName,
        cards: o.cards.map((x) => x.name),
        why: claims.find((cl) => cl.citations.some((x) => x.label === c.label))?.text ?? null,
      };
    })
    .filter((x): x is AskEvidenceCard => x !== null);

  return (
    <>
      <PageHeader
        eyebrow="You asked"
        title={ask.question}
        description={
          <>
            <LocalTime iso={ask.created_at} dateOnly />
            {ask.scope.kind !== 'all' ? ` · scoped to ${scopeLabel(ask.scope.kind)}` : ''}
          </>
        }
        action={
          <Link href="/ask" className="text-sm text-accent underline underline-offset-4">
            Ask another
          </Link>
        }
      />
      {ask.status === 'complete' && ask.answer ? (
        <AnswerView
          model={{
            askId: ask.id,
            question: ask.question,
            conclusion: ask.answer,
            claims,
            evidence,
            evidenceSufficient: ask.evidence_sufficient ?? false,
            found: ask.found,
            narrowerQuestion: ask.narrower_question,
            packageSize: ask.package_object_ids?.length ?? 0,
            droppedCount: ask.dropped_object_ids?.length ?? 0,
            modelId: ask.model_id,
          }}
          feedback={<AskFeedback askId={ask.id} initial={ask.feedback} />}
        />
      ) : ask.status === 'failed' ? (
        <FormMessage tone="info">
          {ask.error_class === 'cancelled'
            ? 'You stopped this one before it finished.'
            : 'This question did not complete. Nothing was lost — ask it again.'}
        </FormMessage>
      ) : (
        <FormMessage tone="info">
          This question is still being answered. Reload in a moment.
        </FormMessage>
      )}
    </>
  );
}

function scopeLabel(kind: 'journey' | 'entity' | 'range'): string {
  return kind === 'journey'
    ? 'one journey'
    : kind === 'entity'
      ? 'one person or place'
      : 'a date range';
}
