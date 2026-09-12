import 'server-only';
import { cookies } from 'next/headers';
import { createServerUserClient, type UserClient } from './client';

/**
 * The request-scoped, RLS-respecting Supabase client for RSCs, route handlers and server
 * actions. Sessions live in httpOnly cookies managed by @supabase/ssr; nothing touches
 * localStorage. Writing cookies from a Server Component throws in Next; that is expected and
 * harmless there because the middleware has already refreshed the session for the request.
 */
export async function createSessionClient(): Promise<UserClient> {
  const store = await cookies();
  return createServerUserClient({
    getAll: () => store.getAll(),
    setAll: (list) => {
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Server Component render: cookie writes are not allowed; middleware owns refresh.
      }
    },
  });
}
