import { describe, expect, it } from 'vitest';
import { REDACTED, scrubEvent } from '../scrub';

describe('scrubEvent (Sentry beforeSend)', () => {
  it('removes a user_notes field wherever it appears', () => {
    const event = scrubEvent({
      extra: { user_notes: 'I think I am going to quit', readingId: 'r1' },
      contexts: { reading: { question: 'Should I?', id: 'r1', nested: { notes: 'x' } } },
      breadcrumbs: [{ message: 'user typed', data: { user_notes: 'secret', route: '/x' } }],
      tags: { userId: 'u1' },
    });
    expect(event.extra).toEqual({ user_notes: REDACTED, readingId: 'r1' });
    expect(event.contexts).toEqual({
      reading: { question: REDACTED, id: 'r1', nested: { notes: REDACTED } },
    });
    expect(event.breadcrumbs?.[0]).toEqual({ data: { user_notes: REDACTED, route: '/x' } });
    expect(event.tags).toEqual({ userId: 'u1' });
  });

  it('drops request bodies, cookies, query strings and auth headers', () => {
    const event = scrubEvent({
      request: {
        url: 'https://x/api/readings',
        method: 'POST',
        data: { question: 'private', user_notes: 'private' },
        cookies: { sb: 'token' },
        query_string: 'q=private',
        headers: { Authorization: 'Bearer x', Cookie: 'a=b', 'x-request-id': 'r1' },
      },
    });
    expect(event.request).toEqual({
      url: 'https://x/api/readings',
      method: 'POST',
      headers: { 'x-request-id': 'r1' },
    });
  });

  it('keeps only the user id', () => {
    const event = scrubEvent({ user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' } });
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('redacts content fields serialised into an error message', () => {
    const event = scrubEvent({
      exception: { values: [{ value: 'Failed to save {"user_notes":"secret text","id":"r1"}' }] },
      message: 'question=Should I leave?',
    });
    expect(event.exception?.values?.[0]?.value).toBe(
      `Failed to save {"user_notes":${REDACTED},"id":"r1"}`,
    );
    expect(event.message).toBe(`question=${REDACTED}`);
  });
});
