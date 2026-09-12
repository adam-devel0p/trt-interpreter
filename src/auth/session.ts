import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createSessionClient } from '@/db/session';
import { SIGN_IN_PATH } from './routes';

/** Request-scoped client, memoised so a layout and its page share one instance. */
export const getSessionClient = cache(createSessionClient);

/**
 * The verified user for this request, or null. `getUser()` validates the token with Supabase
 * Auth rather than trusting the cookie payload; memoised per request.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await getSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/** For server code that must not run anonymously. The middleware already guards routes. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}
