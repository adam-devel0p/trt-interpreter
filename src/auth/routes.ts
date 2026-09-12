/**
 * Route policy for the middleware and its table-driven tests. Pure: no imports.
 *
 * - `PROTECTED_PREFIXES`: everything under `(app)` and `(onboarding)`; unauthenticated visitors
 *   are sent to sign-in with a return-to.
 * - `AUTH_ROUTES`: the `(auth)` screens; signed-in users bounce to Home. `/reset-password` is
 *   deliberately not listed: the recovery link signs the user in before they land there.
 */

export const PROTECTED_PREFIXES = [
  '/home',
  '/journal',
  '/journey',
  '/ask',
  '/profile',
  '/onboarding',
  '/reading',
  '/decks',
] as const;

export const AUTH_ROUTES = ['/sign-in', '/sign-up', '/forgot-password'] as const;

export const SIGN_IN_PATH = '/sign-in';
export const HOME_PATH = '/home';
export const ONBOARDING_PATH = '/onboarding';
export const FIRST_READING_PATH = '/reading/new';

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Only same-origin, absolute-path return targets survive. Anything else (protocol-relative,
 * external, or a bare word) falls back to Home so a crafted link cannot bounce a user off-site.
 */
export function safeReturnPath(candidate: string | null | undefined, fallback = HOME_PATH): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }
  if (/[\r\n]/.test(candidate)) return fallback;
  return candidate;
}

export type RouteDecision = { action: 'next' } | { action: 'redirect'; to: string };

/** The whole middleware decision, so a test can drive it over every route without a server. */
export function decideRoute(input: {
  pathname: string;
  search: string;
  isAuthenticated: boolean;
}): RouteDecision {
  const { pathname, search, isAuthenticated } = input;
  if (isProtectedPath(pathname) && !isAuthenticated) {
    const returnTo = `${pathname}${search}`;
    const qs = returnTo === HOME_PATH ? '' : `?next=${encodeURIComponent(returnTo)}`;
    return { action: 'redirect', to: `${SIGN_IN_PATH}${qs}` };
  }
  if (isAuthPath(pathname) && isAuthenticated) {
    const params = new URLSearchParams(search);
    return { action: 'redirect', to: safeReturnPath(params.get('next')) };
  }
  return { action: 'next' };
}
