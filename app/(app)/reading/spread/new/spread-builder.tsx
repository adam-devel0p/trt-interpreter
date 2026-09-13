'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { autoLayout } from '@/domain/readings/spreadLayout';
import {
  CUSTOM_SPREAD_MAX_POSITIONS,
  CUSTOM_SPREAD_MIN_POSITIONS,
} from '@/domain/readings/thresholds';
import { Button } from '@/ui/components/button';
import { Field, FormMessage } from '@/ui/components/field';
import { SpreadLayout } from '@/ui/components/spread-layout';
import { createSpreadAction, deleteSpreadAction } from '../../actions';

interface PositionDraft {
  name: string;
  prompt: string;
}

export function SpreadBuilder({
  existing,
}: {
  existing: { id: string; name: string; card_count: number }[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [positions, setPositions] = React.useState<PositionDraft[]>([
    { name: '', prompt: '' },
    { name: '', prompt: '' },
    { name: '', prompt: '' },
  ]);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const preview = React.useMemo(
    () =>
      positions.map((p, index) => ({
        index,
        key: `p${index}`,
        name: p.name.trim() || `Position ${index + 1}`,
        prompt: '',
      })),
    [positions],
  );
  const layout = React.useMemo(() => autoLayout(positions.length), [positions.length]);
  const valid = name.trim().length > 0 && positions.every((p) => p.name.trim().length > 0);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createSpreadAction({
        name: name.trim(),
        description: description.trim(),
        positions: positions.map((p) => ({ name: p.name.trim(), prompt: p.prompt.trim() })),
      });
      if (!res.ok) setError(res.message);
      else router.push('/reading/new');
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pending) submit();
        }}
      >
        <Field
          id="spread-name"
          label="Name"
          value={name}
          maxLength={60}
          required
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          id="spread-description"
          label="Description"
          hint="Optional. One line on when you use it."
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
        />

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Positions ({positions.length})</legend>
          <ol className="flex flex-col gap-3">
            {positions.map((p, i) => (
              <li key={i} className="rounded-card bg-surface p-3 hairline">
                <div className="flex items-start gap-2">
                  <span className="pt-2.5 text-sm font-medium text-fg-muted tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Field
                      id={`position-${i}-name`}
                      label={`Position ${i + 1} name`}
                      value={p.name}
                      maxLength={60}
                      required
                      onChange={(e) =>
                        setPositions((ps) =>
                          ps.map((q, k) => (k === i ? { ...q, name: e.target.value } : q)),
                        )
                      }
                    />
                    <Field
                      id={`position-${i}-prompt`}
                      label="What it asks (optional)"
                      value={p.prompt}
                      maxLength={300}
                      onChange={(e) =>
                        setPositions((ps) =>
                          ps.map((q, k) => (k === i ? { ...q, prompt: e.target.value } : q)),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove position ${i + 1}`}
                    disabled={positions.length <= CUSTOM_SPREAD_MIN_POSITIONS}
                    onClick={() => setPositions((ps) => ps.filter((_, k) => k !== i))}
                    className="flex size-9 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={positions.length >= CUSTOM_SPREAD_MAX_POSITIONS}
            onClick={() => setPositions((ps) => [...ps, { name: '', prompt: '' }])}
          >
            Add a position
          </Button>
        </fieldset>

        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
            Layout preview
          </p>
          <SpreadLayout name={name || 'Custom spread'} positions={preview} layout={layout} />
        </div>

        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
          {pending ? 'Saving…' : 'Save spread'}
        </Button>
      </form>

      {existing.length ? (
        <section aria-labelledby="your-spreads-h">
          <h2 id="your-spreads-h" className="mb-2 font-serif text-xl">
            Your spreads
          </h2>
          <ul className="divide-y divide-hairline rounded-card bg-surface hairline">
            {existing.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-fg-muted">
                    {s.card_count} card{s.card_count === 1 ? '' : 's'}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    start(async () => {
                      setDeleteError(null);
                      const res = await deleteSpreadAction(s.id);
                      if (!res.ok) setDeleteError(res.message);
                      else router.refresh();
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          {deleteError ? (
            <FormMessage tone="info" className="mt-2">
              {deleteError}
            </FormMessage>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
