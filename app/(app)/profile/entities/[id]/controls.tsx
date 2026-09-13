'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import type {
  EntityAliasView,
  EntityListItem,
  EntityMentionView,
  EntityMergeView,
  EntityRoleView,
} from '@/db/queries/memory';
import { roleLabel } from '@/domain/entities/relations';
import type { EntityKind } from '@/domain/extraction/schema';
import { Button } from '@/ui/components/button';
import { ConfirmDestructive } from '@/ui/components/confirm-destructive';
import { Field, FormMessage } from '@/ui/components/field';
import { LocalTime } from '@/ui/components/local-time';
import {
  addAliasAction,
  addRoleAction,
  closeRoleAction,
  deleteEntityAction,
  mergeEntitiesAction,
  removeAliasAction,
  renameEntityAction,
  setEntityNotesAction,
  splitEntityAction,
  undoMergeAction,
} from '../actions';

/**
 * Entity corrections (FR-27). Each control is a small form bound to a server action; the
 * outcome is announced in a polite live region and the page refreshes from stored rows.
 */

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const act = (
    fn: () => Promise<{ ok: true } | { ok: false; message: string } | { ok: true; value: unknown }>,
    done: string,
  ) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSaid(done);
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

export function RenameControl({
  entityId,
  label,
  confirmed,
}: {
  entityId: string;
  label: string;
  confirmed: boolean;
}) {
  const { act, pending, status } = useAct();
  const [value, setValue] = React.useState(label);
  React.useEffect(() => setValue(label), [label]);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && value.trim() !== label)
          act(() => renameEntityAction(entityId, value), 'Renamed.');
      }}
    >
      <div className="flex items-end gap-2">
        <Field
          id="entity-name"
          label="Name"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          hint={
            confirmed
              ? 'Confirmed by you.'
              : 'Suggested from how you wrote about them — renaming confirms it.'
          }
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={pending || value.trim() === label}>
          Rename
        </Button>
      </div>
      {status}
    </form>
  );
}

export function NotesControl({ entityId, notes }: { entityId: string; notes: string | null }) {
  const { act, pending, status } = useAct();
  const [value, setValue] = React.useState(notes ?? '');
  const id = React.useId();
  return (
    <form
      className="mt-3 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => setEntityNotesAction(entityId, value), 'Note saved.');
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Your note
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={1000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Who this is, in your words. Never generated."
        className="w-full rounded-control bg-surface px-3 py-2 font-serif text-base hairline placeholder:text-fg-faint"
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={pending || value === (notes ?? '')}
        >
          Save note
        </Button>
        {status}
      </div>
    </form>
  );
}

export function AliasesControl({
  entityId,
  aliases,
}: {
  entityId: string;
  aliases: EntityAliasView[];
}) {
  const { act, pending, status } = useAct();
  const [value, setValue] = React.useState('');
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Names">
        {aliases.map((a) => (
          <li
            key={a.id}
            className={
              a.source === 'user'
                ? 'inline-flex items-center gap-1 rounded-chip bg-surface py-1 pr-1 pl-2.5 text-xs hairline'
                : 'inline-flex items-center gap-1 rounded-chip border border-dashed border-hairline-strong bg-surface-ai py-1 pr-1 pl-2.5 text-xs'
            }
          >
            <span className="text-fg-muted">{a.source === 'user' ? 'you' : 'suggested'}</span>
            <span className="font-medium">{a.alias}</span>
            {a.context ? (
              <span className="text-fg-muted">· {roleLabel(a.context).toLowerCase()}</span>
            ) : null}
            {aliases.length > 1 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  act(() => removeAliasAction(entityId, a.id), `Removed “${a.alias}”.`)
                }
                aria-label={`Remove the name ${a.alias}`}
                className="min-h-7 min-w-7 rounded-chip px-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          act(() => addAliasAction(entityId, value), `Added “${value.trim()}”.`);
          setValue('');
        }}
      >
        <Field
          id="new-alias"
          label="Add a name"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Al, my ex, the agency"
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={pending || !value.trim()}>
          Add
        </Button>
      </form>
      {status}
    </div>
  );
}

export function RolesControl({
  entityId,
  roles,
  options,
}: {
  entityId: string;
  roles: EntityRoleView[];
  options: { role: string; label: string }[];
}) {
  const { act, pending, status } = useAct();
  const today = new Date().toISOString().slice(0, 10);
  const [role, setRole] = React.useState(options[0]?.role ?? 'friend');
  const [from, setFrom] = React.useState(today);
  const roleId = React.useId();
  const fromId = React.useId();
  return (
    <div className="flex flex-col gap-3">
      {roles.length === 0 ? <p className="text-sm text-fg-muted">No role recorded.</p> : null}
      {roles.length ? (
        <ul
          className="divide-y divide-hairline rounded-card bg-surface hairline"
          aria-label="Roles"
        >
          {roles.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <span className="font-medium">{roleLabel(r.role)}</span>
              <span className="text-xs text-fg-muted">
                {r.source === 'user' ? 'set by you' : 'suggested'}
              </span>
              <span className="text-fg-muted">
                from <LocalTime iso={`${r.valid_from}T12:00:00Z`} dateOnly />
                {r.valid_to ? (
                  <>
                    {' '}
                    to <LocalTime iso={`${r.valid_to}T12:00:00Z`} dateOnly />
                  </>
                ) : (
                  ' · current'
                )}
              </span>
              {r.valid_to === null ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => closeRoleAction(entityId, r.id, today),
                      `${roleLabel(r.role)} ended today.`,
                    )
                  }
                  className="text-xs text-fg-muted underline underline-offset-4 hover:text-fg"
                >
                  ended today
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => addRoleAction(entityId, role, from), `${roleLabel(role)} added.`);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-medium">
            Add a role
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
          >
            {options.map((o) => (
              <option key={o.role} value={o.role}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fromId} className="text-sm font-medium">
            From
          </label>
          <input
            id={fromId}
            type="date"
            value={from}
            max={today}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11 rounded-control bg-surface px-3 text-base hairline"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          Add role
        </Button>
      </form>
      {status}
    </div>
  );
}

export function MergeUndoNotice({
  entityId,
  merges,
}: {
  entityId: string;
  merges: EntityMergeView[];
}) {
  const { act, pending, status } = useAct();
  if (merges.length === 0) return null;
  return (
    <div role="status" className="mb-5 rounded-card bg-surface-ai px-4 py-3 text-sm hairline">
      <p>
        {merges.length === 1
          ? 'Another entry was merged into this one'
          : `${merges.length} entries were merged into this one`}{' '}
        — every name, mention and role moved here.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {merges.map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => act(() => undoMergeAction(entityId, m.id), 'Merge undone.')}
          >
            Undo merge from <LocalTime iso={m.merged_at} dateOnly />
          </Button>
        ))}
      </div>
      {status}
    </div>
  );
}

export function MergeControl({
  entityId,
  label,
  others,
}: {
  entityId: string;
  label: string;
  others: EntityListItem[];
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState('');
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState('');
  const id = React.useId();
  const chosen = others.find((o) => o.id === target);
  return (
    <div className="rounded-card bg-surface px-4 py-3 hairline">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Merge “{label}” into
          </label>
          <select
            id={id}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
          >
            <option value="">Choose an entry…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.canonical_label}
                {o.roles.length
                  ? ` (${o.roles.map((r) => roleLabel(r).toLowerCase()).join(', ')})`
                  : ''}
              </option>
            ))}
          </select>
        </div>
        <ConfirmDestructive
          trigger={
            <Button variant="secondary" disabled={!chosen || pending}>
              Merge
            </Button>
          }
          title={`Merge “${label}” into “${chosen?.canonical_label ?? ''}”?`}
          description="Every name, mention and role of this entry moves to the other. Roles with different dates are kept side by side. You can undo it from the other entry."
          confirmLabel="Merge"
          onConfirm={() =>
            new Promise<void>((resolve) => {
              setError(null);
              start(async () => {
                const res = await mergeEntitiesAction(entityId, target);
                if (!res.ok) setError(res.message);
                else {
                  setSaid(`Merged. ${res.value.movedMentions} mentions moved.`);
                  router.push(`/profile/entities/${target}`);
                }
                resolve();
              });
            })
          }
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {error ? (
        <FormMessage tone="error" className="mt-2">
          {error}
        </FormMessage>
      ) : null}
    </div>
  );
}

export function SplitControl({
  entityId,
  kind,
  mentions,
}: {
  entityId: string;
  kind: EntityKind;
  mentions: EntityMentionView[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [label, setLabel] = React.useState('');
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const canSplit = mentions.length > 1;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  if (!canSplit)
    return (
      <p className="rounded-card bg-surface px-4 py-3 text-sm text-fg-muted hairline">
        Split needs at least two mentions to choose between.
      </p>
    );
  return (
    <div className="rounded-card bg-surface px-4 py-3 hairline">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Split off some mentions
        </Button>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await splitEntityAction(entityId, picked, label, kind);
              if (!res.ok) setError(res.message);
              else router.push(`/profile/entities/${res.value.id}`);
            });
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">Which mentions belong to someone else?</legend>
            <ul className="mt-1.5 flex flex-col gap-1">
              {mentions.map((m) => (
                <li key={m.id}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(m.id)}
                      disabled={picked.length >= mentions.length - 1 && !picked.includes(m.id)}
                      onChange={() => toggle(m.id)}
                      className="size-4"
                    />
                    <span>
                      “{m.mention_text}”
                      {m.reading ? (
                        <span className="text-fg-muted">
                          {' '}
                          · <LocalTime iso={m.reading.occurred_at} dateOnly /> ·{' '}
                          {m.reading.is_open_reflection ? 'Open reflection' : m.reading.question}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Field
            id="split-label"
            label="Name for the new entry"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Alex from the club"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              disabled={pending || picked.length === 0 || !label.trim()}
            >
              Split
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        </form>
      )}
    </div>
  );
}

export function RemoveControl({
  entityId,
  label,
  mentionCount,
}: {
  entityId: string;
  label: string;
  mentionCount: number;
}) {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="rounded-card bg-surface px-4 py-3 hairline">
      <ConfirmDestructive
        trigger={<Button variant="destructive">Remove “{label}”</Button>}
        title={`Remove “${label}”?`}
        description={`Its names, roles and ${mentionCount} ${mentionCount === 1 ? 'mention' : 'mentions'} go; your readings are untouched. It may be suggested again from a future reading.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          const res = await deleteEntityAction(entityId);
          if (res && !res.ok) setError(res.message);
        }}
      />
      {error ? (
        <FormMessage tone="error" className="mt-2">
          {error}
        </FormMessage>
      ) : null}
    </div>
  );
}
