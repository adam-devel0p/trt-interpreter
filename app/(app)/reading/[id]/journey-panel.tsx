'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { ReadingJourneyMembership } from '@/db/queries/journeys';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { InferredChip } from '@/ui/components/inferred-chip';
import {
  addReadingToJourneyAction,
  confirmMemberAction,
  createJourneyAction,
  removeMemberAction,
  restoreMemberAction,
} from '../../journey/actions';

/**
 * Journey membership on the reading detail (spec §6.5): a confirmed membership reads as
 * yours, an automatic one as "suggested" with why and one-tap keep / remove, a pending one
 * as the inline question "Part of X?" — never a modal. Plus the manual escape hatches: add
 * to a journey, start a new one from this reading.
 */
export function JourneyPanel({
  readingId,
  memberships,
  options,
}: {
  readingId: string;
  memberships: ReadingJourneyMembership[];
  options: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const [undo, setUndo] = React.useState<{
    memberId: string;
    previous: string;
    title: string;
  } | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [target, setTarget] = React.useState('');
  const [newTitle, setNewTitle] = React.useState('');

  const act = (
    fn: () => Promise<{ ok: true; value?: unknown } | { ok: false; message: string }>,
    done: string,
    after?: (v: unknown) => void,
  ) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSaid(done);
      after?.(res.value);
      router.refresh();
    });
  };

  const asked = memberships.filter((m) => m.state === 'pending');
  const held = memberships.filter((m) => m.state !== 'pending');

  return (
    <div className="flex flex-col gap-3" data-testid="journey-panel">
      {asked.map((m) => (
        <div
          key={m.member_id}
          className="rounded-card border border-dashed border-hairline-strong bg-surface-ai px-4 py-3 text-sm"
        >
          <p>
            Part of{' '}
            <Link
              href={`/journey/${m.journey.id}`}
              className="font-medium underline underline-offset-4"
            >
              {m.journey.title}
            </Link>
            ?
          </p>
          {m.reasons.length ? (
            <p className="mt-0.5 text-xs text-fg-muted">{m.reasons.join('. ')}.</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                act(
                  () => confirmMemberAction(m.member_id, readingId),
                  `Added to ${m.journey.title}.`,
                )
              }
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => act(() => removeMemberAction(m.member_id, readingId), 'Left out.')}
            >
              No
            </Button>
          </div>
        </div>
      ))}
      {held.length || undo ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Journeys">
          {held.map((m) => (
            <li key={m.member_id}>
              {m.state === 'confirmed' ? (
                <span className="inline-flex items-center gap-1 rounded-chip bg-accent-soft py-1 pr-1 pl-2.5 text-xs">
                  <span className="text-fg-muted">you</span>
                  <Link
                    href={`/journey/${m.journey.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {m.journey.title}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Remove from ${m.journey.title}`}
                    className="min-h-7 rounded-chip px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => removeMemberAction(m.member_id, readingId),
                        `Removed from ${m.journey.title}.`,
                        (v) =>
                          setUndo({
                            memberId: m.member_id,
                            previous: (v as { previous: string }).previous,
                            title: m.journey.title,
                          }),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ) : (
                <InferredChip
                  reasons={m.reasons}
                  onKeep={() =>
                    act(
                      () => confirmMemberAction(m.member_id, readingId),
                      `Kept in ${m.journey.title}.`,
                    )
                  }
                  onDismiss={() =>
                    act(
                      () => removeMemberAction(m.member_id, readingId),
                      `Removed from ${m.journey.title}.`,
                      (v) =>
                        setUndo({
                          memberId: m.member_id,
                          previous: (v as { previous: string }).previous,
                          title: m.journey.title,
                        }),
                    )
                  }
                >
                  <Link href={`/journey/${m.journey.id}`} className="underline underline-offset-4">
                    {m.journey.title}
                  </Link>
                </InferredChip>
              )}
            </li>
          ))}
          {undo ? (
            <li className="inline-flex items-center gap-1 text-xs text-fg-muted">
              Removed from {undo.title}.
              <button
                type="button"
                className="min-h-7 rounded-chip px-1.5 text-accent underline underline-offset-4"
                disabled={pending}
                onClick={() =>
                  act(
                    () => restoreMemberAction(undo.memberId, undo.previous, readingId),
                    'Put back.',
                    () => setUndo(null),
                  )
                }
              >
                Undo
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">
          Not part of a journey. Related readings gather on their own over time — or add this one
          now.
        </p>
      )}
      {adding ? (
        <form
          className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3 hairline"
          onSubmit={(e) => {
            e.preventDefault();
            if (target === '__new')
              act(
                () => createJourneyAction(newTitle, [readingId]),
                'Journey started.',
                () => setAdding(false),
              );
            else if (target)
              act(
                () => addReadingToJourneyAction(target, readingId),
                'Added.',
                () => setAdding(false),
              );
          }}
        >
          <label htmlFor="journey-pick" className="text-sm font-medium">
            Add to a journey
          </label>
          <select
            id="journey-pick"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-h-11 rounded-control bg-surface px-3 text-base text-fg hairline"
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
            <option value="__new">A new journey…</option>
          </select>
          {target === '__new' ? (
            <>
              <label htmlFor="journey-new-title" className="text-sm font-medium">
                What is it about?
              </label>
              <input
                id="journey-new-title"
                value={newTitle}
                maxLength={80}
                onChange={(e) => setNewTitle(e.target.value)}
                className="min-h-11 rounded-control bg-surface px-3 text-base text-fg hairline"
              />
            </>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={pending || !target || (target === '__new' && !newTitle.trim())}
            >
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="link"
          size="sm"
          className="self-start text-sm"
          onClick={() => setAdding(true)}
        >
          Add to a journey
        </Button>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
