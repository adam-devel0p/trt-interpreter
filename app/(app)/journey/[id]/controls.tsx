'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { JourneyMemberView, JourneyRow, MemberState } from '@/db/queries/journeys';
import { Button } from '@/ui/components/button';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { Field, FormMessage } from '@/ui/components/field';
import {
  closeJourneyAction,
  confirmMemberAction,
  deleteJourneyAction,
  mergeJourneysAction,
  removeMemberAction,
  renameJourneyAction,
  restoreMemberAction,
  splitJourneyAction,
  undoMergeJourneysAction,
} from '../actions';

/**
 * Journey management (spec §6.5): rename (pins the title), close / reopen, merge with undo,
 * split, delete, and per-member keep / remove with undo. Each control is a small form bound
 * to a server action; outcomes are announced in a polite live region and the page refreshes
 * from stored rows. Removing a member never touches the reading.
 */

type Res = { ok: true; value?: unknown } | { ok: false; message: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const act = (fn: () => Promise<Res>, done: string, after?: (r: Res) => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSaid(done);
      after?.(res);
      router.refresh();
    });
  };
  const status = (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </>
  );
  return { act, pending, status };
}

export function RenameControl({ journey }: { journey: JourneyRow }) {
  const { act, pending, status } = useAct();
  const [value, setValue] = React.useState(journey.title);
  React.useEffect(() => setValue(journey.title), [journey.title]);
  const hint =
    journey.title_source === 'user'
      ? 'Named by you. It stays as you wrote it.'
      : journey.title_source === 'model'
        ? 'Suggested title. Renaming keeps yours for good.'
        : 'A placeholder from what the readings share. Renaming keeps yours for good.';
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && value.trim() !== journey.title)
          act(() => renameJourneyAction(journey.id, value), 'Renamed.');
      }}
    >
      <div className="flex items-end gap-2">
        <Field
          id="journey-title"
          label="Title"
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          hint={hint}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || value.trim() === journey.title}
        >
          Rename
        </Button>
      </div>
      {journey.rationale && journey.title_source !== 'user' ? (
        <p className="text-xs text-fg-muted">
          <span className="font-medium">Why this title · </span>
          {journey.rationale}
        </p>
      ) : null}
      {status}
    </form>
  );
}

export function StatusControl({ journey }: { journey: JourneyRow }) {
  const { act, pending, status } = useAct();
  const closed = journey.status === 'closed';
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={pending}
        onClick={() =>
          act(() => closeJourneyAction(journey.id, closed), closed ? 'Reopened.' : 'Closed.')
        }
      >
        {closed ? 'Reopen this journey' : 'Close this journey'}
      </Button>
      <p className="text-xs text-fg-muted">
        {closed
          ? 'Closed journeys stay readable; nothing new is gathered into them.'
          : 'Closing keeps everything; new readings just stop gathering here.'}
      </p>
      {status}
    </div>
  );
}

/**
 * A removal's undo must outlive the removed item (the timeline re-renders without it), so
 * it is offered through this context and shown by `UndoBar` above the timeline.
 */
interface UndoOffer {
  memberId: string;
  previous: MemberState;
  label: string;
}
const UndoContext = React.createContext<{
  offer: (o: UndoOffer) => void;
  current: UndoOffer | null;
  clear: () => void;
} | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = React.useState<UndoOffer | null>(null);
  const value = React.useMemo(
    () => ({ offer: setCurrent, current, clear: () => setCurrent(null) }),
    [current],
  );
  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function UndoBar({ readingId }: { readingId?: string }) {
  const ctx = React.useContext(UndoContext);
  const { act, pending, status } = useAct();
  if (!ctx?.current) return null;
  const o = ctx.current;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card bg-accent-soft px-4 py-2 text-sm">
      <span>Removed “{o.label}” from this journey. The reading is untouched.</span>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          act(
            () => restoreMemberAction(o.memberId, o.previous, readingId),
            'Put back.',
            () => ctx.clear(),
          )
        }
      >
        Undo
      </Button>
      {status}
    </div>
  );
}

export function MemberControls({
  member,
  label,
  readingId,
}: {
  member: Pick<JourneyMemberView, 'id' | 'state'>;
  label: string;
  readingId?: string;
}) {
  const { act, pending, status } = useAct();
  const undo = React.useContext(UndoContext);
  return (
    <span className="inline-flex items-center gap-1">
      {member.state === 'auto' ? (
        <button
          type="button"
          className="min-h-7 rounded-chip px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          disabled={pending}
          onClick={() => act(() => confirmMemberAction(member.id, readingId), 'Kept.')}
        >
          keep
        </button>
      ) : null}
      <button
        type="button"
        className="min-h-7 rounded-chip px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Remove from this journey"
        disabled={pending}
        onClick={() =>
          act(
            () => removeMemberAction(member.id, readingId),
            'Removed from this journey. The reading is untouched.',
            (r) =>
              undo?.offer({
                memberId: member.id,
                previous: ((r as { value?: { previous?: MemberState } }).value?.previous ??
                  'confirmed') as MemberState,
                label,
              }),
          )
        }
      >
        remove
      </button>
      {status}
    </span>
  );
}

export function PendingMemberControls({
  memberId,
  readingId,
}: {
  memberId: string;
  readingId?: string;
}) {
  const { act, pending, status } = useAct();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => act(() => confirmMemberAction(memberId, readingId), 'Added.')}
      >
        Yes, part of this
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => act(() => removeMemberAction(memberId, readingId), 'Left out.')}
      >
        No
      </Button>
      {status}
    </span>
  );
}

export function MergeControl({
  journey,
  others,
}: {
  journey: JourneyRow;
  others: { id: string; title: string }[];
}) {
  const { act, pending, status } = useAct();
  const [target, setTarget] = React.useState('');
  const chosen = others.find((o) => o.id === target);
  if (others.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="merge-target" className="text-sm font-medium">
        Merge into another journey
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="merge-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-h-11 flex-1 rounded-control bg-surface px-3 text-base text-fg hairline"
        >
          <option value="">Choose a journey…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
        <ConfirmDestructive
          trigger={
            <Button variant="secondary" disabled={pending || !chosen}>
              Merge
            </Button>
          }
          title={`Merge “${journey.title}” into “${chosen?.title ?? ''}”?`}
          description="Every reading moves across; this journey closes. You can undo it from the other journey's page."
          confirmLabel="Merge"
          onConfirm={() => act(() => mergeJourneysAction(journey.id, target), 'Merged.')}
        />
      </div>
      {status}
    </div>
  );
}

export function MergeUndoNotice({ merged }: { merged: { id: string; title: string }[] }) {
  const { act, pending, status } = useAct();
  if (merged.length === 0) return null;
  return (
    <div
      className="mb-5 rounded-card bg-accent-soft px-4 py-3 text-sm"
      role="region"
      aria-label="Merged journeys"
    >
      {merged.map((m) => (
        <p key={m.id} className="flex flex-wrap items-center gap-2">
          <span>“{m.title}” was merged into this journey.</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => act(() => undoMergeJourneysAction(m.id), 'Merge undone.')}
          >
            Undo
          </Button>
        </p>
      ))}
      {status}
    </div>
  );
}

export function SplitControl({
  journey,
  members,
}: {
  journey: JourneyRow;
  members: { id: string; title: string; at: string }[];
}) {
  const { act, pending, status } = useAct();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  if (members.length < 2) return null;
  if (!open)
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Split some readings off
      </Button>
    );
  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-surface px-4 py-3 hairline"
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () => splitJourneyAction(journey.id, title, [...chosen]),
          'Split off.',
          () => setOpen(false),
        );
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Readings to move</legend>
        {members.map((m) => (
          <label key={m.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.has(m.id)}
              onChange={() => toggle(m.id)}
              className="h-5 w-5"
            />
            <span className="truncate">{m.title}</span>
          </label>
        ))}
      </fieldset>
      <Field
        id="split-title"
        label="Name for the new journey"
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || chosen.size === 0 || chosen.size >= members.length || !title.trim()}
        >
          Split
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {chosen.size >= members.length ? (
        <p className="text-xs text-fg-muted">
          Leave at least one reading here — otherwise rename instead.
        </p>
      ) : null}
      {status}
    </form>
  );
}

export function DeleteControl({
  journey,
  memberCount,
}: {
  journey: JourneyRow;
  memberCount: number;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <ConfirmDestructive
        trigger={
          <Button variant="secondary" size="sm" className="self-start">
            Delete this journey
          </Button>
        }
        title={`Delete “${journey.title}”?`}
        description={`The journey and its progression go; the ${memberCount} ${memberCount === 1 ? 'reading stays' : 'readings stay'} exactly as they are.`}
        confirmLabel="Delete journey"
        onConfirm={async () => {
          const res = await deleteJourneyAction(journey.id);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          router.push('/journey');
        }}
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
