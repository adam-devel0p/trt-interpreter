import { describe, expect, it } from 'vitest';
import { AUTH_ROUTES, decideRoute, PROTECTED_PREFIXES, safeReturnPath } from '../routes';

describe('route policy', () => {
  it.each(PROTECTED_PREFIXES)('redirects an unauthenticated visitor away from %s', (path) => {
    const d = decideRoute({ pathname: path, search: '', isAuthenticated: false });
    expect(d.action).toBe('redirect');
    if (d.action === 'redirect') expect(d.to.startsWith('/sign-in')).toBe(true);
  });

  it.each(PROTECTED_PREFIXES)('lets an authenticated user through to %s', (path) => {
    expect(decideRoute({ pathname: path, search: '', isAuthenticated: true })).toEqual({
      action: 'next',
    });
  });

  it('protects nested paths and carries the return-to, but not for Home itself', () => {
    expect(
      decideRoute({ pathname: '/journal/abc', search: '?q=1', isAuthenticated: false }),
    ).toEqual({
      action: 'redirect',
      to: `/sign-in?next=${encodeURIComponent('/journal/abc?q=1')}`,
    });
    expect(decideRoute({ pathname: '/home', search: '', isAuthenticated: false })).toEqual({
      action: 'redirect',
      to: '/sign-in',
    });
  });

  it.each(AUTH_ROUTES)('bounces a signed-in user from %s to Home (or a safe next)', (path) => {
    expect(decideRoute({ pathname: path, search: '', isAuthenticated: true })).toEqual({
      action: 'redirect',
      to: '/home',
    });
    expect(
      decideRoute({ pathname: path, search: '?next=%2Fprofile', isAuthenticated: true }),
    ).toEqual({ action: 'redirect', to: '/profile' });
  });

  it('leaves public and reset-password routes alone in both states', () => {
    for (const authed of [true, false]) {
      for (const p of ['/', '/privacy', '/reset-password', '/offline', '/auth/callback']) {
        expect(decideRoute({ pathname: p, search: '', isAuthenticated: authed })).toEqual({
          action: 'next',
        });
      }
    }
  });

  it('only accepts same-origin absolute paths as return targets', () => {
    expect(safeReturnPath('/journal')).toBe('/journal');
    expect(safeReturnPath('//evil.example')).toBe('/home');
    expect(safeReturnPath('https://evil.example/x')).toBe('/home');
    expect(safeReturnPath('/\\evil.example')).toBe('/home');
    expect(safeReturnPath('journal')).toBe('/home');
    expect(safeReturnPath('/x\r\nSet-Cookie: a=b')).toBe('/home');
    expect(safeReturnPath(null)).toBe('/home');
    expect(safeReturnPath(undefined, '/onboarding')).toBe('/onboarding');
  });
});
