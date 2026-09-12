/**
 * Sentry `beforeSend` scrubber. Removes request bodies and every known content-bearing field
 * from an event before it leaves the process. Pure and dependency-free so it is unit-testable
 * without Sentry.
 */

/** Field names that may carry journal content anywhere in an event payload. */
export const CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'user_notes',
  'userNotes',
  'question',
  'body',
  'notes',
  'note',
  'description',
  'text',
  'answer',
  'summary',
  'user_meaning',
  'userMeaning',
  'mention_text',
  'mentionText',
  'canonical_label',
  'canonicalLabel',
  'alias',
  'title',
  'prompt',
  'completion',
  'messages',
  'system',
  'content',
  'payload',
  'data',
  'email',
]);

export const REDACTED = '[redacted]';

type JsonLike = Record<string, unknown>;

function isObject(v: unknown): v is JsonLike {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively replaces the value of any content field with `[redacted]`. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
  if (!isObject(value)) return value;
  const out: JsonLike = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = CONTENT_FIELDS.has(k) ? REDACTED : scrubDeep(v, depth + 1);
  }
  return out as T;
}

/** Minimal structural type for the parts of a Sentry event we touch. */
export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    query_string?: unknown;
    [k: string]: unknown;
  };
  user?: { id?: string; email?: string; ip_address?: string; [k: string]: unknown };
  extra?: JsonLike;
  contexts?: JsonLike;
  tags?: JsonLike;
  breadcrumbs?: Array<{ data?: JsonLike; message?: string; [k: string]: unknown }>;
  exception?: { values?: Array<{ value?: string; [k: string]: unknown }> };
  message?: string;
  [k: string]: unknown;
}

/**
 * Scrubs an outgoing event. Request bodies, cookies and auth headers are dropped outright;
 * content fields are redacted wherever they appear; the user object keeps only `id`.
 */
export function scrubEvent<E extends object>(event: E): E {
  const out: ScrubbableEvent = { ...(event as ScrubbableEvent) };

  if (out.request) {
    const { data: _data, cookies: _cookies, query_string: _qs, headers, ...rest } = out.request;
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      const lower = k.toLowerCase();
      if (lower === 'authorization' || lower === 'cookie' || lower === 'x-api-key') continue;
      safeHeaders[k] = v;
    }
    out.request = { ...rest, headers: safeHeaders };
  }

  if (out.user) {
    out.user = out.user.id ? { id: out.user.id } : {};
  }

  if (out.extra) out.extra = scrubDeep(out.extra);
  if (out.contexts) out.contexts = scrubDeep(out.contexts);
  if (out.tags) out.tags = scrubDeep(out.tags);
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((b) => {
      const { message: _m, ...rest } = b;
      return { ...rest, data: b.data ? scrubDeep(b.data) : undefined };
    });
  }
  // Error messages are kept (they are code-authored), but any of our content-field names that
  // leaked into a message string (e.g. a serialized object) are conservatively redacted.
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({ ...v, value: redactInline(v.value) })),
    };
  }
  if (typeof out.message === 'string') out.message = redactInline(out.message);

  return out as unknown as E;
}

function redactInline(s: string | undefined): string | undefined {
  if (!s) return s;
  let result = s;
  for (const field of CONTENT_FIELDS) {
    // `"user_notes":"…"` or `user_notes=…` shapes.
    result = result.replace(
      new RegExp(`(["']?${field}["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^,;&}\\n]+)`, 'g'),
      `$1${REDACTED}`,
    );
  }
  return result;
}
