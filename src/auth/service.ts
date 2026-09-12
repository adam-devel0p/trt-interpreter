/**
 * Auth use-cases with injected dependencies so they run in tests without Next. The server
 * actions in ./actions.ts are thin: gather request context, call these, redirect.
 *
 * Every function returns an `AuthOutcome`; it never throws for user-caused failures. Failure
 * copy is generic on purpose (see ./copy.ts). Logs carry IDs and error classes only.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { AUTH_RATE_RULES, type RateLimiter, type RateLimitRule } from '@/domain/auth/rateLimit';
import { errorClassOf, type Logger } from '@/observability/logger';
import { AUTH_COPY } from './copy';
import { HOME_PATH, ONBOARDING_PATH, safeReturnPath } from './routes';

export interface AuthContext {
  supabase: UserClient;
  limiter: RateLimiter;
  /** Client IP, or null when per-IP limiting does not apply (loopback; see ./limiter.ts). */
  ip: string | null;
  /** Absolute origin used to build email/OAuth redirect URLs. */
  origin: string;
  log: Logger;
}

export type FieldErrors = Partial<Record<'email' | 'password' | 'confirm', string>>;

export type AuthOutcome =
  | { kind: 'redirect'; to: string }
  | { kind: 'sent'; message: string }
  | { kind: 'error'; message: string; fields?: FieldErrors };

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);

const credentialsSchema = z.object({ email: emailSchema, password: passwordSchema });
const emailOnlySchema = z.object({ email: emailSchema });
const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'] });

function fieldErrorsOf(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path[0];
    if (key === 'email') out.email ??= AUTH_COPY.invalidEmail;
    else if (key === 'password') out.password ??= AUTH_COPY.passwordTooShort;
    else if (key === 'confirm') out.confirm ??= AUTH_COPY.passwordsDoNotMatch;
  }
  return out;
}

function invalid(fields: FieldErrors): AuthOutcome {
  const first =
    fields.email ?? fields.password ?? fields.confirm ?? 'Check the form and try again.';
  return { kind: 'error', message: first, fields };
}

const rateLimited = (): AuthOutcome => ({ kind: 'error', message: AUTH_COPY.rateLimited });

function callbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithPassword(
  ctx: AuthContext,
  input: { email: unknown; password: unknown; next?: string | null },
): Promise<AuthOutcome> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsOf(parsed.error));
  const { email, password } = parsed.data;

  const byIp = hitIp(ctx, 'sign_in', AUTH_RATE_RULES.signInIp);
  const byEmail = ctx.limiter.hit(`sign_in:email:${email}`, AUTH_RATE_RULES.signInEmail);
  if (!byIp || !byEmail.allowed) {
    ctx.log.warn('auth.sign_in.rate_limited', { route: '/sign-in' });
    return rateLimited();
  }

  const { data, error } = await ctx.supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    ctx.log.info('auth.sign_in.failed', { errorClass: error?.code ?? errorClassOf(error) });
    return { kind: 'error', message: AUTH_COPY.signInFailed };
  }
  ctx.limiter.reset(`sign_in:email:${email}`);
  ctx.log.info('auth.sign_in.ok', { userId: data.user.id });
  return { kind: 'redirect', to: safeReturnPath(input.next) };
}

export async function signUpWithPassword(
  ctx: AuthContext,
  input: { email: unknown; password: unknown },
): Promise<AuthOutcome> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsOf(parsed.error));
  const { email, password } = parsed.data;

  if (!hitIp(ctx, 'sign_up', AUTH_RATE_RULES.signUpIp)) {
    ctx.log.warn('auth.sign_up.rate_limited', { route: '/sign-up' });
    return rateLimited();
  }

  const { data, error } = await ctx.supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl(ctx.origin, ONBOARDING_PATH) },
  });
  if (error) {
    ctx.log.info('auth.sign_up.failed', { errorClass: error.code ?? errorClassOf(error) });
    return { kind: 'error', message: AUTH_COPY.signUpFailed };
  }
  if (data.session) {
    ctx.log.info('auth.sign_up.ok', { userId: data.user?.id });
    return { kind: 'redirect', to: ONBOARDING_PATH };
  }
  // Confirmation required (or an obfuscated existing-user response): same message either way.
  ctx.log.info('auth.sign_up.confirmation_sent');
  return { kind: 'sent', message: AUTH_COPY.linkSent };
}

export async function sendMagicLink(
  ctx: AuthContext,
  input: { email: unknown; next?: string | null },
): Promise<AuthOutcome> {
  const parsed = emailOnlySchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsOf(parsed.error));
  const { email } = parsed.data;
  if (!emailLinkAllowed(ctx, email, 'magic_link')) return rateLimited();

  const { error } = await ctx.supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl(ctx.origin, safeReturnPath(input.next)),
      shouldCreateUser: true,
    },
  });
  if (error)
    ctx.log.info('auth.magic_link.failed', { errorClass: error.code ?? errorClassOf(error) });
  else ctx.log.info('auth.magic_link.sent');
  // Never reveal whether the address exists or whether sending failed for it.
  return { kind: 'sent', message: AUTH_COPY.linkSent };
}

export async function requestPasswordReset(
  ctx: AuthContext,
  input: { email: unknown },
): Promise<AuthOutcome> {
  const parsed = emailOnlySchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsOf(parsed.error));
  const { email } = parsed.data;
  if (!emailLinkAllowed(ctx, email, 'reset')) return rateLimited();

  const { error } = await ctx.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl(ctx.origin, '/reset-password'),
  });
  if (error) ctx.log.info('auth.reset.failed', { errorClass: error.code ?? errorClassOf(error) });
  else ctx.log.info('auth.reset.sent');
  return { kind: 'sent', message: AUTH_COPY.linkSent };
}

export async function updatePassword(
  ctx: AuthContext,
  input: { password: unknown; confirm: unknown },
): Promise<AuthOutcome> {
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsOf(parsed.error));
  if (!hitIp(ctx, 'password_update', AUTH_RATE_RULES.passwordUpdate)) return rateLimited();
  const { data, error } = await ctx.supabase.auth.updateUser({ password: parsed.data.password });
  if (error || !data.user) {
    ctx.log.info('auth.password_update.failed', { errorClass: error?.code ?? errorClassOf(error) });
    return { kind: 'error', message: AUTH_COPY.passwordUpdateFailed };
  }
  ctx.log.info('auth.password_update.ok', { userId: data.user.id });
  return { kind: 'redirect', to: HOME_PATH };
}

export async function startOAuth(
  ctx: AuthContext,
  input: { provider: 'google'; next?: string | null },
): Promise<AuthOutcome> {
  const { data, error } = await ctx.supabase.auth.signInWithOAuth({
    provider: input.provider,
    options: { redirectTo: callbackUrl(ctx.origin, safeReturnPath(input.next)) },
  });
  if (error || !data.url) {
    ctx.log.warn('auth.oauth.unavailable', { errorClass: error?.code ?? errorClassOf(error) });
    return { kind: 'error', message: AUTH_COPY.oauthUnavailable };
  }
  return { kind: 'redirect', to: data.url };
}

export async function signOut(ctx: Pick<AuthContext, 'supabase' | 'log'>): Promise<AuthOutcome> {
  const { error } = await ctx.supabase.auth.signOut();
  if (error)
    ctx.log.warn('auth.sign_out.failed', { errorClass: error.code ?? errorClassOf(error) });
  else ctx.log.info('auth.sign_out.ok');
  return { kind: 'redirect', to: '/sign-in' };
}

/** Per-IP bucket; always allowed when there is no IP to key on (loopback). */
function hitIp(ctx: AuthContext, scope: string, rule: RateLimitRule): boolean {
  if (ctx.ip === null) return true;
  return ctx.limiter.hit(`${scope}:ip:${ctx.ip}`, rule).allowed;
}

function emailLinkAllowed(ctx: AuthContext, email: string, kind: string): boolean {
  const byIp = hitIp(ctx, kind, AUTH_RATE_RULES.emailLinkIp);
  const byEmail = ctx.limiter.hit(`${kind}:email:${email}`, AUTH_RATE_RULES.emailLinkEmail);
  if (byIp && byEmail.allowed) return true;
  ctx.log.warn('auth.email_link.rate_limited', { route: kind });
  return false;
}
