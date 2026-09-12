'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logger } from '@/observability/logger';
import { authLimiter, clientIp } from './limiter';
import { requestOrigin } from './origin';
import * as service from './service';
import { getSessionClient } from './session';
import type { AuthContext, AuthOutcome } from './service';
import type { AuthFormState } from './form-state';

async function context(): Promise<AuthContext> {
  const h = await headers();
  const origin = requestOrigin((n) => h.get(n));
  return {
    supabase: await getSessionClient(),
    limiter: authLimiter(),
    ip: await clientIp(),
    origin,
    log: logger,
  };
}

/** Turn a service outcome into a form state, or leave the request via redirect. */
function settle(outcome: AuthOutcome, values?: { email?: string }): AuthFormState {
  if (outcome.kind === 'redirect') redirect(outcome.to);
  if (outcome.kind === 'sent') return { status: 'sent', message: outcome.message, values };
  return { status: 'error', message: outcome.message, fields: outcome.fields, values };
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};

export async function signInAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const ctx = await context();
  const email = str(fd, 'email');
  return settle(
    await service.signInWithPassword(ctx, {
      email,
      password: str(fd, 'password'),
      next: str(fd, 'next') || null,
    }),
    { email },
  );
}

export async function signUpAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const ctx = await context();
  const email = str(fd, 'email');
  return settle(await service.signUpWithPassword(ctx, { email, password: str(fd, 'password') }), {
    email,
  });
}

export async function magicLinkAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const ctx = await context();
  const email = str(fd, 'email');
  return settle(await service.sendMagicLink(ctx, { email, next: str(fd, 'next') || null }), {
    email,
  });
}

export async function forgotPasswordAction(
  _prev: AuthFormState,
  fd: FormData,
): Promise<AuthFormState> {
  const ctx = await context();
  const email = str(fd, 'email');
  return settle(await service.requestPasswordReset(ctx, { email }), { email });
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  fd: FormData,
): Promise<AuthFormState> {
  const ctx = await context();
  return settle(
    await service.updatePassword(ctx, {
      password: str(fd, 'password'),
      confirm: str(fd, 'confirm'),
    }),
  );
}

export async function googleSignInAction(
  _prev: AuthFormState,
  fd: FormData,
): Promise<AuthFormState> {
  const ctx = await context();
  return settle(
    await service.startOAuth(ctx, { provider: 'google', next: str(fd, 'next') || null }),
  );
}

export async function signOutAction(): Promise<void> {
  const outcome = await service.signOut({ supabase: await getSessionClient(), log: logger });
  if (outcome.kind === 'redirect') redirect(outcome.to);
}
