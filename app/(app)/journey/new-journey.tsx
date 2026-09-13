'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/ui/components/button';
import { Field, FormMessage } from '@/ui/components/field';
import { createJourneyAction } from './actions';

/** Manual creation (invariant 10 cuts both ways: never required, always possible). */
export function NewJourneyForm() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Start a journey yourself
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3 hairline"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createJourneyAction(title);
          if (!res.ok) {
            setError(res.message);
            return;
          }
          router.push(`/journey/${res.value.id}`);
        });
      }}
    >
      <Field
        id="new-journey-title"
        label="What is it about?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        hint="A person, a place, a situation. You can add readings from each reading's page."
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </form>
  );
}
