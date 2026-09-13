import { describe, expect, it } from 'vitest';
import { findRegisterViolations, hedgeCount } from '../register';

describe('hedged register (spec §3.3, §9.3)', () => {
  it.each([
    ['There is a 70% chance this works out.', 'percentage'],
    ['This will happen by spring.', 'will happen'],
    ['You will get the job.', 'you will'],
    ['This is definitely the end of it.', 'definitely'],
    ['The cards say you must leave.', 'the cards say you must'],
    ['You must decide now.', 'you must'],
    ['It is guaranteed.', 'guaranteed'],
    ['You are destined for this.', 'destined'],
  ])('flags “%s”', (text, pattern) => {
    expect(findRegisterViolations(text).map((v) => v.pattern)).toContain(pattern);
  });

  it('accepts hedged reflection', () => {
    const text =
      'The Tower here suggests something that felt stable may be shifting; one way to read this is as relief rather than loss. You might ask yourself what you were holding up. Free will, in this reading, seems to be the point.';
    expect(findRegisterViolations(text)).toEqual([]);
    expect(hedgeCount(text)).toBeGreaterThanOrEqual(3);
  });
});
