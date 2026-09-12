/**
 * RLS-respecting Supabase clients. Everything user-facing goes through these; the service-role
 * client lives in ./admin and is lint-guarded.
 */
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { clientEnv } from '@/config/env';

export type UserClient = SupabaseClient;

/** Browser-side client (anon key + the user's session cookie). Use from 'use client' code. */
export function createBrowserUserClient(): UserClient {
  const env = clientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: CookieOptions }[]): void;
}

/**
 * Server-side client bound to the request's cookies (RSC, route handlers, server actions).
 * Pass the adapter from `next/headers` cookies(); kept injectable so this module stays free of
 * a `next` import and testable outside a request.
 */
export function createServerUserClient(cookies: CookieAdapter): UserClient {
  const env = clientEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies,
  });
}

/**
 * Client authenticated with an explicit access token. Used by the RLS test harness and by
 * background code acting on behalf of a user without a cookie session.
 */
export function createTokenUserClient(accessToken: string): UserClient {
  const env = clientEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Unauthenticated client. Sees only what public policies allow (reference tables later). */
export function createAnonClient(): UserClient {
  const env = clientEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
