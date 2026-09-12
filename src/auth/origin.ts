/**
 * The origin the browser actually used, from proxy-aware headers. `request.url` in Next can
 * be rewritten to `localhost`, which is a different cookie origin from `127.0.0.1` — a
 * redirect there would drop the session that was just set.
 */
export function requestOrigin(get: (name: string) => string | null): string {
  const origin = get('origin');
  if (origin) return origin;
  const proto = get('x-forwarded-proto') ?? 'http';
  const host = get('x-forwarded-host') ?? get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}
