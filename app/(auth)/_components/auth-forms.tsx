'use client';

import Link from 'next/link';
import * as React from 'react';
import {
  forgotPasswordAction,
  googleSignInAction,
  magicLinkAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from '@/auth/actions';
import { AUTH_IDLE, type AuthFormState } from '@/auth/form-state';
import { Button } from '@/ui/components/button';
import { Field, FormMessage } from '@/ui/components/field';

function SubmitButton({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {children}
    </Button>
  );
}

function Feedback({ state }: { state: AuthFormState }) {
  if (state.status === 'error' && !state.fields) {
    return <FormMessage tone="error">{state.message}</FormMessage>;
  }
  if (state.status === 'sent') return <FormMessage tone="info">{state.message}</FormMessage>;
  return null;
}

const fieldError = (state: AuthFormState, key: 'email' | 'password' | 'confirm') =>
  state.status === 'error' ? state.fields?.[key] : undefined;
const keptEmail = (state: AuthFormState) =>
  state.status === 'idle' ? undefined : state.values?.email;

export function GoogleButton({ next }: { next?: string }) {
  const [state, action, pending] = React.useActionState(googleSignInAction, AUTH_IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button type="submit" variant="secondary" size="lg" className="w-full" disabled={pending}>
        Continue with Google
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
      <span className="h-px flex-1 bg-hairline" />
      or
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = React.useActionState(signInAction, AUTH_IDLE);
  const [magicState, magicAction, magicPending] = React.useActionState(magicLinkAction, AUTH_IDLE);
  const [mode, setMode] = React.useState<'password' | 'magic'>('password');
  return (
    <div className="flex flex-col gap-6">
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      <GoogleButton next={next} />
      <Divider />
      {mode === 'password' ? (
        <form action={action} className="flex flex-col gap-4" noValidate>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Field
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={keptEmail(state)}
            error={fieldError(state, 'email')}
          />
          <Field
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            error={fieldError(state, 'password')}
          />
          <Feedback state={state} />
          <SubmitButton pending={pending}>Sign in</SubmitButton>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button
              type="button"
              className="text-accent underline underline-offset-4"
              onClick={() => setMode('magic')}
            >
              Email me a sign-in link instead
            </button>
            <Link href="/forgot-password" className="text-accent underline underline-offset-4">
              Forgot password?
            </Link>
          </div>
        </form>
      ) : (
        <form action={magicAction} className="flex flex-col gap-4" noValidate>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Field
            id="magic-email"
            name="email"
            type="email"
            label="Email"
            hint="We'll send a one-time link. No password needed."
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={keptEmail(magicState)}
            error={fieldError(magicState, 'email')}
          />
          <Feedback state={magicState} />
          <SubmitButton pending={magicPending}>Send sign-in link</SubmitButton>
          <button
            type="button"
            className="self-start text-sm text-accent underline underline-offset-4"
            onClick={() => setMode('password')}
          >
            Use a password instead
          </button>
        </form>
      )}
      <p className="text-sm text-fg-muted">
        New here?{' '}
        <Link href="/sign-up" className="text-accent underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export function SignUpForm() {
  const [state, action, pending] = React.useActionState(signUpAction, AUTH_IDLE);
  return (
    <div className="flex flex-col gap-6">
      <GoogleButton next="/onboarding" />
      <Divider />
      <form action={action} className="flex flex-col gap-4" noValidate>
        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={keptEmail(state)}
          error={fieldError(state, 'email')}
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          hint="At least 8 characters."
          autoComplete="new-password"
          minLength={8}
          required
          error={fieldError(state, 'password')}
        />
        <Feedback state={state} />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
      <p className="text-sm text-fg-muted">
        Already have one?{' '}
        <Link href="/sign-in" className="text-accent underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = React.useActionState(forgotPasswordAction, AUTH_IDLE);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={keptEmail(state)}
        error={fieldError(state, 'email')}
      />
      <Feedback state={state} />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
      <Link href="/sign-in" className="self-start text-sm text-accent underline underline-offset-4">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = React.useActionState(resetPasswordAction, AUTH_IDLE);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        id="password"
        name="password"
        type="password"
        label="New password"
        hint="At least 8 characters."
        autoComplete="new-password"
        minLength={8}
        required
        error={fieldError(state, 'password')}
      />
      <Field
        id="confirm"
        name="confirm"
        type="password"
        label="Repeat new password"
        autoComplete="new-password"
        required
        error={fieldError(state, 'confirm')}
      />
      <Feedback state={state} />
      <SubmitButton pending={pending}>Save new password</SubmitButton>
    </form>
  );
}
