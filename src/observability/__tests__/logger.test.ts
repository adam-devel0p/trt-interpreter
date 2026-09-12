import { describe, expect, it } from 'vitest';
import { createLogger, sanitizeProps, type LogLine } from '../logger';

describe('logger', () => {
  it('emits structured JSON lines with only whitelisted props', () => {
    const lines: LogLine[] = [];
    const log = createLogger((l) => lines.push(l), { requestId: 'req-1' });
    log.info('jobs.claimed', { jobId: 'j1', count: 3 });
    expect(lines[0]).toMatchObject({
      level: 'info',
      event: 'jobs.claimed',
      requestId: 'req-1',
      jobId: 'j1',
      count: 3,
    });
    expect(typeof lines[0]?.ts).toBe('string');
  });

  it('drops unknown keys at runtime even if the type system is bypassed', () => {
    const smuggled = { userId: 'u', user_notes: 'I think my partner is leaving', question: 'x' };
    expect(sanitizeProps(smuggled)).toEqual({ userId: 'u' });
  });

  it('caps string lengths so an ID field cannot become a prose channel', () => {
    const long = 'x'.repeat(1000);
    expect(sanitizeProps({ objectId: long }).objectId).toHaveLength(128);
  });

  it('rejects malformed event names', () => {
    const log = createLogger(() => {});
    // @ts-expect-error — not a namespaced event
    expect(() => log.info('user wrote: something private')).toThrow(/Invalid log event/);
  });

  it('child loggers merge scoped props', () => {
    const lines: LogLine[] = [];
    const log = createLogger((l) => lines.push(l)).child({ userId: 'u1' });
    log.warn('ai.run.failed', { errorClass: 'timeout' });
    expect(lines[0]).toMatchObject({ userId: 'u1', errorClass: 'timeout' });
  });
});
