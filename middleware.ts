import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute, isAuthPath, isProtectedPath } from '@/auth/routes';
import { clientEnv } from '@/config/env';

/**
 * Session refresh + route protection (docs/phases/phase-01-auth-onboarding.md §1).
 *
 * Runs only where a session matters: protected app routes and the auth screens. The Supabase
 * client refreshes an expiring session and writes the rotated cookies onto the response;
 * `getUser()` validates the token server-side rather than trusting the cookie's claims.
 * Public routes (marketing, offline shell, API) never pay for the auth round-trip.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isProtectedPath(pathname) && !isAuthPath(pathname)) return NextResponse.next();

  let response = NextResponse.next({ request });
  const env = clientEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // An unreachable auth service or a malformed cookie counts as signed out, never as a 500.
  const isAuthenticated = await supabase.auth
    .getUser()
    .then(({ data }) => !!data.user)
    .catch(() => false);

  const decision = decideRoute({ pathname, search, isAuthenticated });
  if (decision.action === 'next') return response;

  const redirectResponse = NextResponse.redirect(new URL(decision.to, request.url));
  // Carry any refreshed (or cleared) session cookies across the redirect.
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return redirectResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
