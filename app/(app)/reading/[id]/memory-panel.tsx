'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { EntityListItem, MentionView, ReadingMemory } from '@/db/queries/memory';
import type { EntityKind } from '@/domain/extraction/schema';
import { roleLabel } from '@/domain/entities/relations';
import { LIFE_AREAS } from '@/domain/readings/types';
import { Button } from '@/ui/components/button';
import { FormMessage } from '@/ui/components/field';
import { InferredChip } from '@/ui/components/inferred-chip';
import { cn } from '@/ui/lib/cn';
import {
  correctMetadataAction,
  listEntityOptionsAction,
  retryExtractionAction,
} from '../memory-actions';

/**
 * "Connections" on the reading detail (§6.3): the structured memory a reading grew — life
 * area, themes, people and places, possibilities, a timeframe — every one labelled as
 * inferred, with "why?", a one-tap correction and a dismissal (§4.4, FR-26). Renders stored
 * rows; polls the memory route while an extraction is queued; never calls a model. A
 * correction writes an override and the panel refreshes from the server.
 */
export interface MemoryPanelProps {
  readingId: string;
  initial: ReadingMemory;
  /** Consent given and the extraction flag on for this user. */
  enabled: boolean;
  /** Straight after the save: expect a queued extraction and poll for it. */
  expectExtraction: boolean;
}

const POLL_MS = 3000;
const POLL_MAX = 40;
const KIND_LABEL: Record<EntityKind, string> = {
  person: 'person',
  organization: 'organisation',
  place: 'place',
  project: 'project',
  object: 'thing',
  other: 'other',
};

export function MemoryPanel({ readingId, initial, enabled, expectExtraction }: MemoryPanelProps) {
  const router = useRouter();
  const [memory, setMemory] = React.useState(initial);
  const [announce, setAnnounce] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const polls = React.useRef(0);
  React.useEffect(() => setMemory(initial), [initial]);

  const waiting =
    enabled && (memory.latest === null ? expectExtraction : memory.latest.status === 'pending');

  React.useEffect(() => {
    if (!waiting || polls.current >= POLL_MAX) return;
    const t = setTimeout(async () => {
      polls.current += 1;
      try {
        const res = await fetch(`/api/readings/${readingId}/memory`, { cache: 'no-store' });
        if (res.ok) {
          const next = (await res.json()) as ReadingMemory;
          setMemory(next);
          if (next.latest?.status === 'complete') {
            setAnnounce('Suggestions ready.');
            router.refresh();
          }
        }
      } catch {
        // Try again on the next tick; a missed poll changes nothing.
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, memory, readingId, router]);

  const correct = (correction: unknown, said: string) => {
    setError(null);
    start(async () => {
      const res = await correctMetadataAction(readingId, correction);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setAnnounce(said);
      router.refresh();
    });
  };

  if (!enabled) {
    return (
      <div className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm text-fg-muted">
        <p className="font-medium text-fg">Not sorted.</p>
        <p className="mt-1">
          With AI on, readings are quietly sorted into people, places and themes you can correct.
          Nothing is sent to a model until you turn it on in{' '}
          <Link href="/profile" className="text-accent underline underline-offset-4">
            Profile
          </Link>
          .
        </p>
      </div>
    );
  }

  const eff = memory.effective;
  const latest = memory.latest;

  return (
    <div
      data-memory-panel
      data-state={
        eff ? 'ready' : waiting ? 'waiting' : latest?.status === 'failed' ? 'failed' : 'idle'
      }
      className="rounded-card border-l-2 border-hairline-strong bg-surface-ai px-4 py-3 text-sm"
    >
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
        Suggested by AI · one way to sort this reading
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {!eff && waiting ? (
        <p role="status" className="mt-2 text-fg-muted">
          Looking for the people, places and themes in this reading…
        </p>
      ) : null}
      {!eff && !waiting && latest?.status === 'failed' ? (
        <div className="mt-2">
          <p className="text-fg-muted">
            Couldn’t sort this reading. Your words are unchanged; it will be tried again.
          </p>
          <RetryButton readingId={readingId} onQueued={() => setAnnounce('Queued.')} />
        </div>
      ) : null}
      {!eff && !waiting && !latest ? (
        <div className="mt-2">
          <p className="text-fg-muted">Nothing sorted yet.</p>
          <RetryButton
            readingId={readingId}
            onQueued={() => setAnnounce('Queued.')}
            label="Sort this reading"
          />
        </div>
      ) : null}

      {eff ? (
        <div className="mt-3 flex flex-col gap-4">
          {memory.stale ? (
            <p
              role="status"
              className="rounded-control bg-surface px-3 py-2 text-xs text-fg-muted hairline"
            >
              These were read from an earlier version of this reading. They will refresh after the
              next pass.
            </p>
          ) : null}

          <Group title="Life area">
            {eff.lifeArea.value ? (
              eff.lifeArea.source === 'user' ? (
                <UserChip
                  onClear={() =>
                    correct(
                      { type: 'clear', fieldPath: 'life_area' },
                      'Life area reset to the suggestion.',
                    )
                  }
                >
                  {areaLabel(eff.lifeArea.value)}
                </UserChip>
              ) : (
                <LifeAreaChip
                  value={eff.lifeArea.value}
                  disabled={pending}
                  onSet={(v) => correct({ type: 'set_life_area', value: v }, 'Life area changed.')}
                  onDismiss={() =>
                    correct({ type: 'set_life_area', value: null }, 'Life area removed.')
                  }
                />
              )
            ) : (
              <LifeAreaChip
                value={null}
                disabled={pending}
                onSet={(v) => correct({ type: 'set_life_area', value: v }, 'Life area set.')}
              />
            )}
          </Group>

          <Group title="Themes">
            {memory.themes.length === 0 ? <Empty>No themes suggested.</Empty> : null}
            {memory.themes.map((t) =>
              t.user_confirmed ? (
                <UserChip
                  key={t.id}
                  onClear={() =>
                    correct(
                      { type: 'clear', fieldPath: `themes/${t.slug}` },
                      `${t.label} unpinned.`,
                    )
                  }
                >
                  {t.label}
                </UserChip>
              ) : (
                <InferredChip
                  key={t.id}
                  reasons={[
                    `Weighed ${t.weight >= 0.8 ? 'strongly' : t.weight >= 0.6 ? 'moderately' : 'lightly'} in your words`,
                    `Category: ${t.category}`,
                  ]}
                  onKeep={() =>
                    correct({ type: 'confirm_theme', slug: t.slug }, `${t.label} kept.`)
                  }
                  onDismiss={() =>
                    correct({ type: 'dismiss_theme', slug: t.slug }, `${t.label} dismissed.`)
                  }
                >
                  {t.label}
                </InferredChip>
              ),
            )}
            <AddTheme
              disabled={pending}
              onAdd={(label) => correct({ type: 'add_theme', label }, `${label} added.`)}
            />
          </Group>

          <Group title="People and places">
            {memory.mentions.length === 0 ? <Empty>No one and nowhere in particular.</Empty> : null}
            {memory.mentions.map((m) => (
              <MentionChip
                key={m.id}
                mention={m}
                disabled={pending}
                onLink={(entityId) =>
                  correct({ type: 'link_entity', mention: m.mention_text, entityId }, 'Linked.')
                }
                onNew={() =>
                  correct(
                    { type: 'new_entity', mention: m.mention_text, kind: m.entity.kind },
                    'Added as someone new.',
                  )
                }
                onDismiss={() =>
                  correct({ type: 'dismiss_entity', mention: m.mention_text }, 'Removed.')
                }
                onClear={() =>
                  correct(
                    { type: 'clear', fieldPath: `entities/${m.mention_normalized}` },
                    'Link reset to the suggestion.',
                  )
                }
              />
            ))}
          </Group>

          <Group title="Possibilities" stacked>
            {memory.predictions.filter((p) => !p.dismissed_at).length === 0 ? (
              <Empty>No possibilities raised.</Empty>
            ) : null}
            {memory.predictions
              .filter((p) => !p.dismissed_at)
              .map((p) => (
                <PossibilityRow
                  key={p.id}
                  text={p.text}
                  edited={p.user_edited}
                  timeframe={p.timeframe_text}
                  disabled={pending}
                  onEdit={(text) =>
                    correct(
                      { type: 'edit_possibility', key: p.text_hash, text },
                      'Possibility updated.',
                    )
                  }
                  onDismiss={() =>
                    correct(
                      { type: 'dismiss_possibility', key: p.text_hash },
                      'Possibility dismissed.',
                    )
                  }
                  onClear={() =>
                    correct(
                      { type: 'clear', fieldPath: `possibilities/${p.text_hash}` },
                      'Possibility reset.',
                    )
                  }
                />
              ))}
          </Group>

          <Group title="Timeframe">
            {eff.timeframe?.text ? (
              eff.timeframe.source === 'user' ? (
                <UserChip
                  onClear={() =>
                    correct({ type: 'clear', fieldPath: 'timeframe' }, 'Timeframe reset.')
                  }
                >
                  {eff.timeframe.text}
                </UserChip>
              ) : (
                <TimeframeChip
                  text={eff.timeframe.text}
                  disabled={pending}
                  onEdit={(text) => correct({ type: 'edit_timeframe', text }, 'Timeframe changed.')}
                  onDismiss={() => correct({ type: 'dismiss_timeframe' }, 'Timeframe removed.')}
                />
              )
            ) : (
              <Empty>No horizon named.</Empty>
            )}
          </Group>

          {latest ? (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer">Why am I seeing this?</summary>
              <p className="mt-1">
                A model read your question and note (never the cards as evidence about your life)
                and proposed these; rules decided which people are the same. Model{' '}
                <span className="font-mono">{latest.model_id ?? 'unknown'}</span>, prompt{' '}
                <span className="font-mono">{latest.prompt_version}</span>, schema{' '}
                <span className="font-mono">{latest.schema_version}</span>. Anything you correct
                stays corrected.
              </p>
              <RetryButton
                readingId={readingId}
                onQueued={() => setAnnounce('Queued.')}
                label="Sort again"
              />
            </details>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <FormMessage tone="error" className="mt-2">
          {error}
        </FormMessage>
      ) : null}
    </div>
  );
}

function Group({
  title,
  children,
  stacked = false,
}: {
  title: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-xs font-medium text-fg-muted">{title}</h3>
      <div className={cn('flex gap-1.5', stacked ? 'flex-col' : 'flex-wrap items-center')}>
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-fg-muted">{children}</p>;
}

/** A value the user set or kept: solid, labelled "you", removable. */
function UserChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-chip bg-surface py-1 pr-1 pl-2.5 text-xs hairline">
      <span className="text-fg-muted">you</span>
      <span className="truncate font-medium">{children}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Undo this correction"
        className="min-h-7 min-w-7 rounded-chip px-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        ×
      </button>
    </span>
  );
}

function areaLabel(key: string): string {
  return LIFE_AREAS.find((a) => a.key === key)?.label ?? key;
}

function LifeAreaChip({
  value,
  disabled,
  onSet,
  onDismiss,
}: {
  value: string | null;
  disabled: boolean;
  onSet: (v: string) => void;
  onDismiss?: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const id = React.useId();
  if (editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Life area
        </label>
        <select
          id={id}
          autoFocus
          defaultValue={value ?? ''}
          disabled={disabled}
          onChange={(e) => {
            setEditing(false);
            if (e.target.value) onSet(e.target.value);
          }}
          className="min-h-9 rounded-control bg-surface px-2 text-sm hairline"
        >
          <option value="">Pick a life area…</option>
          {LIFE_AREAS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-fg-muted underline"
        >
          cancel
        </button>
      </span>
    );
  }
  if (!value)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-fg-muted underline underline-offset-4"
      >
        Set a life area
      </button>
    );
  return (
    <InferredChip
      reasons={['From the wording of your question and note']}
      onCorrect={() => setEditing(true)}
      onDismiss={onDismiss}
    >
      {areaLabel(value)}
    </InferredChip>
  );
}

function AddTheme({ disabled, onAdd }: { disabled: boolean; onAdd: (label: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const id = React.useId();
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-fg-muted underline underline-offset-4"
      >
        Add a theme
      </button>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const label = text.trim();
        if (!label) return;
        onAdd(label);
        setText('');
        setOpen(false);
      }}
    >
      <label htmlFor={id} className="sr-only">
        New theme
      </label>
      <input
        id={id}
        autoFocus
        value={text}
        maxLength={120}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Trust"
        className="min-h-9 w-40 rounded-control bg-surface px-2 text-sm hairline"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={disabled}>
        Add
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-fg-muted underline"
      >
        cancel
      </button>
    </form>
  );
}

function MentionChip({
  mention,
  disabled,
  onLink,
  onNew,
  onDismiss,
  onClear,
}: {
  mention: MentionView;
  disabled: boolean;
  onLink: (entityId: string) => void;
  onNew: () => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  const [picking, setPicking] = React.useState(false);
  const label =
    mention.entity.canonical_label.toLowerCase() === mention.mention_text.toLowerCase()
      ? mention.entity.canonical_label
      : `${mention.entity.canonical_label} · as “${mention.mention_text}”`;
  const kind = KIND_LABEL[mention.entity.kind];
  const asks = mention.ask_candidates?.length ? mention.ask_options : [];

  if (mention.resolution === 'user') {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-chip bg-surface py-1 pr-1 pl-2.5 text-xs hairline">
        <span className="text-fg-muted">you</span>
        <Link
          href={`/profile/entities/${mention.entity_id}`}
          className="truncate font-medium underline-offset-4 hover:underline"
        >
          {label}
        </Link>
        <button
          type="button"
          onClick={onClear}
          aria-label="Undo this link"
          className="min-h-7 min-w-7 rounded-chip px-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          ×
        </button>
      </span>
    );
  }

  if (asks.length) {
    return (
      <div
        role="group"
        aria-label={`Which ${mention.mention_text}?`}
        className="w-full rounded-control bg-surface px-3 py-2 hairline"
      >
        <p className="text-xs">
          <span className="text-fg-muted">possibly · </span>
          Which <span className="font-medium">{mention.mention_text}</span> is this?
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {asks.map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => onLink(o.id)}
            >
              {o.canonical_label}
              {o.roles.length
                ? ` (${o.roles.map((r) => roleLabel(r).toLowerCase()).join(', ')})`
                : ''}
            </Button>
          ))}
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onNew}>
            Someone else
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-fg-muted underline underline-offset-4"
          >
            not a {kind}
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <InferredChip
        label={mention.resolution === 'tentative' ? 'possibly' : 'suggested'}
        reasons={mention.reasons.length ? mention.reasons : ['A new name in your journal']}
        correctLabel="link…"
        onCorrect={() => setPicking((p) => !p)}
        onDismiss={onDismiss}
      >
        <Link
          href={`/profile/entities/${mention.entity_id}`}
          className="underline-offset-4 hover:underline"
        >
          {label}
        </Link>
      </InferredChip>
      {picking ? (
        <EntityPicker
          exclude={mention.entity_id}
          mentionText={mention.mention_text}
          disabled={disabled}
          onPick={(id) => {
            setPicking(false);
            onLink(id);
          }}
          onNew={() => {
            setPicking(false);
            onNew();
          }}
          onKeep={() => {
            setPicking(false);
            onLink(mention.entity_id);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
    </span>
  );
}

function EntityPicker({
  exclude,
  mentionText,
  disabled,
  onPick,
  onNew,
  onKeep,
  onCancel,
}: {
  exclude: string;
  mentionText: string;
  disabled: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = React.useState<EntityListItem[] | null>(null);
  const id = React.useId();
  React.useEffect(() => {
    let live = true;
    listEntityOptionsAction().then((res) => {
      if (live) setOptions(res.ok ? res.value : []);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        Who is {mentionText}?
      </label>
      <select
        id={id}
        autoFocus
        disabled={disabled || options === null}
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') onNew();
          else if (v === '__keep') onKeep();
          else if (v) onPick(v);
        }}
        className="min-h-9 max-w-56 rounded-control bg-surface px-2 text-sm hairline"
      >
        <option value="">{options === null ? 'Loading…' : `Who is ${mentionText}?`}</option>
        <option value="__keep">This is right — keep it</option>
        {(options ?? [])
          .filter((o) => o.id !== exclude)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.canonical_label}
              {o.roles.length
                ? ` (${o.roles.map((r) => roleLabel(r).toLowerCase()).join(', ')})`
                : ''}
            </option>
          ))}
        <option value="__new">Someone new</option>
      </select>
      <button type="button" onClick={onCancel} className="text-xs text-fg-muted underline">
        cancel
      </button>
    </span>
  );
}

function PossibilityRow({
  text,
  edited,
  timeframe,
  disabled,
  onEdit,
  onDismiss,
  onClear,
}: {
  text: string;
  edited: boolean;
  timeframe: string | null;
  disabled: boolean;
  onEdit: (text: string) => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(text);
  const id = React.useId();
  if (editing) {
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onEdit(draft.trim());
          setEditing(false);
        }}
      >
        <label htmlFor={id} className="sr-only">
          Possibility
        </label>
        <textarea
          id={id}
          autoFocus
          value={draft}
          maxLength={400}
          rows={2}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-control bg-surface px-2 py-1 text-sm hairline"
        />
        <span className="flex gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={disabled}>
            Save
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-fg-muted underline"
          >
            cancel
          </button>
        </span>
      </form>
    );
  }
  return (
    <div className="flex items-start gap-1.5">
      {edited ? (
        <UserChip onClear={onClear}>{text}</UserChip>
      ) : (
        <InferredChip
          label="possibly"
          reasons={[
            'Raised by the wording of your question — a possibility, never a prediction',
            ...(timeframe ? [`Horizon named: ${timeframe}`] : []),
          ]}
          correctLabel="edit"
          onCorrect={() => setEditing(true)}
          onDismiss={onDismiss}
          className="whitespace-normal"
        >
          <span className="whitespace-normal">{text}</span>
        </InferredChip>
      )}
    </div>
  );
}

function TimeframeChip({
  text,
  disabled,
  onEdit,
  onDismiss,
}: {
  text: string;
  disabled: boolean;
  onEdit: (text: string) => void;
  onDismiss: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(text);
  const id = React.useId();
  if (editing)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onEdit(draft.trim());
          setEditing(false);
        }}
      >
        <label htmlFor={id} className="sr-only">
          Timeframe
        </label>
        <input
          id={id}
          autoFocus
          value={draft}
          maxLength={120}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-9 w-40 rounded-control bg-surface px-2 text-sm hairline"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled}>
          Save
        </Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-fg-muted underline"
        >
          cancel
        </button>
      </form>
    );
  return (
    <InferredChip
      reasons={['A horizon your question names']}
      correctLabel="edit"
      onCorrect={() => setEditing(true)}
      onDismiss={onDismiss}
    >
      {text}
    </InferredChip>
  );
}

function RetryButton({
  readingId,
  onQueued,
  label = 'Try again',
}: {
  readingId: string;
  onQueued: () => void;
  label?: string;
}) {
  const [state, setState] = React.useState<'idle' | 'queued' | 'error'>('idle');
  const [pending, start] = React.useTransition();
  return (
    <span className="mt-2 inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || state === 'queued'}
        onClick={() =>
          start(async () => {
            const res = await retryExtractionAction(readingId);
            setState(res.ok ? 'queued' : 'error');
            if (res.ok) onQueued();
          })
        }
      >
        {state === 'queued' ? 'Queued' : label}
      </Button>
      {state === 'queued' ? (
        <span className="text-xs text-fg-muted">Runs within a minute or so.</span>
      ) : null}
      {state === 'error' ? <span className="text-xs text-danger">Couldn’t queue that.</span> : null}
    </span>
  );
}
