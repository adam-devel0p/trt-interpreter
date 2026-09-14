'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { DeletionReceiptRow, ExportRequestRow } from '@/db/queries/exports';
import { Button } from '@/ui/components/button';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { FormMessage } from '@/ui/components/field';
import { LocalTime } from '@/ui/components/local-time';
import type { AiArtifactCounts } from '@/privacy/aiArtifacts';
import { deleteAiArtifactsAction, requestExportAction } from './actions';

const STATUS_LABEL: Record<ExportRequestRow['status'], string> = {
  queued: 'Preparing',
  running: 'Preparing',
  ready: 'Ready',
  failed: 'Did not complete',
  expired: 'Expired',
};

function formatBytes(n: number | null): string {
  if (n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Export everything (FR-22): one button, then the history with a download link per archive.
 * A queued export usually turns ready within the same request; the list re-polls while one is
 * in flight so the person never has to reload.
 */
export function ExportControls({ exports: rows }: { exports: ExportRequestRow[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(
    null,
  );
  const inFlight = rows.some((r) => r.status === 'queued' || r.status === 'running');

  React.useEffect(() => {
    if (!inFlight) {
      setMessage((m) => (m?.tone === 'info' ? null : m));
      return;
    }
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Export everything</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            A zip of JSON files: every reading, card, note (with earlier versions), AI
            interpretation with its versions, and the links between them. Yours on any plan.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || inFlight}
          onClick={() => {
            setMessage(null);
            start(async () => {
              const res = await requestExportAction();
              if (!res.ok) setMessage({ tone: 'error', text: res.message });
              else setMessage({ tone: 'info', text: 'Preparing your export.' });
              router.refresh();
            });
          }}
        >
          {pending || inFlight ? 'Preparing…' : 'Export'}
        </Button>
      </div>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      {rows.length ? (
        <ol className="flex flex-col divide-y divide-hairline text-sm" aria-label="Export history">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <LocalTime iso={r.requested_at} />
                <span className="text-fg-muted">
                  {' '}
                  · {STATUS_LABEL[r.status]}
                  {r.status === 'ready' && r.size_bytes !== null
                    ? ` · ${formatBytes(r.size_bytes)}`
                    : ''}
                </span>
                {r.status === 'ready' && r.expires_at ? (
                  <span className="block text-xs text-fg-muted">
                    Link available until <LocalTime iso={r.expires_at} dateOnly />
                  </span>
                ) : null}
              </span>
              {r.status === 'ready' ? (
                <a
                  href={`/api/exports/${r.id}/download`}
                  download
                  className="inline-flex min-h-11 items-center px-2 text-accent underline underline-offset-4"
                >
                  Download
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** §10: remove every AI artifact, keep every word. Names exactly what goes before it goes. */
export function DeleteAiArtifactsControl({ counts }: { counts: AiArtifactCounts }) {
  const router = useRouter();
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(
    null,
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const memory =
    counts.extractions + counts.object_themes + counts.entity_mentions + counts.predictions;
  const description =
    total === 0
      ? 'There is nothing generated to remove right now.'
      : `${plural(counts.interpretations, 'AI interpretation')}, ` +
        `${plural(counts.safety_flags, 'topic flag')}, ` +
        `${plural(counts.question_embeddings, 'question fingerprint')}, ` +
        `${plural(memory, 'suggested theme, mention or possibility', 'suggested themes, mentions and possibilities')} and ` +
        `${plural(counts.entities, 'unconfirmed person or place', 'unconfirmed people and places')}` +
        (counts.journeys + counts.journey_members > 0
          ? ` and ${plural(counts.journeys, 'automatically gathered journey')} (with ${plural(counts.journey_members, 'suggested membership')})`
          : '') +
        (counts.links > 0 ? ` and ${plural(counts.links, 'suggested connection')}` : '') +
        (counts.embeddings + counts.retrieval_documents > 0
          ? ` and ${plural(counts.embeddings, 'search vector')}`
          : '') +
        (counts.asks > 0
          ? ` and ${plural(counts.asks, 'question you asked your history, with its answer', 'questions you asked your history, with their answers')}`
          : '') +
        (counts.period_summaries + counts.journey_narratives > 0
          ? ` and ${plural(counts.period_summaries, 'generated retrospective summary', 'generated retrospective summaries')} and ${plural(counts.journey_narratives, 'journey narrative')}`
          : '') +
        ' will be removed. Every reading, card and note you wrote stays exactly as it is, and so do your own corrections. This cannot be undone.';
  return (
    <div className="flex flex-col items-end gap-2">
      <ConfirmDestructive
        trigger={
          <Button variant="secondary" size="sm" disabled={total === 0}>
            Delete
          </Button>
        }
        title="Delete AI artifacts?"
        description={description}
        confirmLabel="Delete AI artifacts"
        onConfirm={async () => {
          const res = await deleteAiArtifactsAction();
          if (!res.ok) setMessage({ tone: 'error', text: res.message });
          else {
            const n = Object.values(res.value.counts).reduce((a, b) => a + b, 0);
            setMessage({
              tone: 'info',
              text: `Removed ${n} generated item${n === 1 ? '' : 's'}. Your words are untouched.`,
            });
            router.refresh();
          }
        }}
      />
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </div>
  );
}

const SCOPE_LABEL: Record<DeletionReceiptRow['scope'], string> = {
  reading: 'A reading',
  life_event: 'A life event',
  ai_artifacts: 'AI artifacts',
  history: 'All history',
  account: 'Account',
};

/** Recent deletion receipts: proof, by count, that the purge happened (§19). */
export function DeletionReceipts({ receipts }: { receipts: DeletionReceiptRow[] }) {
  if (receipts.length === 0) return null;
  return (
    <ol
      className="flex flex-col divide-y divide-hairline px-4 text-sm"
      aria-label="Recent deletions"
    >
      {receipts.map((r) => {
        const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
        return (
          <li key={r.id} className="py-2">
            <LocalTime iso={r.completed_at} />
            <span className="text-fg-muted">
              {' '}
              · {SCOPE_LABEL[r.scope]} · {n} row{n === 1 ? '' : 's'} purged
            </span>
          </li>
        );
      })}
    </ol>
  );
}
