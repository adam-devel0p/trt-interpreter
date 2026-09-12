import { describe, expectTypeOf, it } from 'vitest';
import { logger, type LogProps } from '../logger';

/**
 * Type-level proof that the logger is content-free by construction. Each @ts-expect-error
 * line fails the typecheck if the logger ever starts accepting content-bearing props.
 */
describe('logger types', () => {
  it('accepts whitelisted props', () => {
    logger.info('http.request', { requestId: 'r', userId: 'u', durationMs: 1, status: 200 });
    expectTypeOf<LogProps>().toHaveProperty('objectId');
  });

  it('rejects content-bearing props in literals', () => {
    // @ts-expect-error user_notes is journal content
    logger.info('http.request', { user_notes: 'private text' });
    // @ts-expect-error question is journal content
    logger.error('ai.run.failed', { question: 'Should I leave?' });
    // @ts-expect-error body is content
    logger.warn('jobs.failed', { jobId: 'j', body: 'text' });
  });

  it('rejects content-bearing props from variables (no excess-property loophole)', () => {
    const props = { userId: 'u', description: 'my life event' };
    // @ts-expect-error description is not a LogProp even via a variable
    logger.info('privacy.delete', props);
  });

  it('rejects free-form event names', () => {
    // @ts-expect-error event must be namespaced
    logger.info('something happened');
  });
});
