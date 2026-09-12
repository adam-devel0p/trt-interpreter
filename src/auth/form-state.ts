import type { FieldErrors } from './service';

/** Form state for `useActionState` on the auth screens. `idle` on first render. */
export type AuthFormState =
  | { status: 'idle' }
  /** `values` echoes what was typed so a reset form (React 19 resets after an action) keeps it. */
  | { status: 'error'; message: string; fields?: FieldErrors; values?: { email?: string } }
  | { status: 'sent'; message: string; values?: { email?: string } };

export const AUTH_IDLE: AuthFormState = { status: 'idle' };

/** Form state for single-preference writes on the Profile screen. */
export type PrefState = { status: 'idle' } | { status: 'error'; message: string };

export const PREF_IDLE: PrefState = { status: 'idle' };
