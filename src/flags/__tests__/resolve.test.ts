import { describe, expect, it } from 'vitest';
import { envKeyFor, FLAGS, isFlagName } from '../flags';
import { parseSessionOverrides, resolveFlag } from '../resolve';

describe('flag resolution', () => {
  it('env default applies when nothing overrides', () => {
    expect(resolveFlag({ envDefault: true, allowSessionOverride: true })).toBe(true);
    expect(resolveFlag({ envDefault: false, allowSessionOverride: true })).toBe(false);
  });
  it('user override beats env', () => {
    expect(
      resolveFlag({ envDefault: false, userOverride: true, allowSessionOverride: false }),
    ).toBe(true);
  });
  it('session override beats user override only where allowed', () => {
    const layers = { envDefault: false, userOverride: true, sessionOverride: false };
    expect(resolveFlag({ ...layers, allowSessionOverride: true })).toBe(false);
    expect(resolveFlag({ ...layers, allowSessionOverride: false })).toBe(true);
  });
  it('parses the dev cookie defensively', () => {
    expect(parseSessionOverrides(undefined)).toEqual({});
    expect(parseSessionOverrides('not json')).toEqual({});
    expect(parseSessionOverrides(encodeURIComponent('{"ai_extraction":true,"x":"no"}'))).toEqual({
      ai_extraction: true,
    });
  });
  it('maps flag names to env keys', () => {
    expect(envKeyFor('ai_extraction')).toBe('FLAG_AI_EXTRACTION');
    expect(FLAGS).toHaveLength(8);
    expect(isFlagName('share_cards')).toBe(true);
    expect(isFlagName('nope')).toBe(false);
  });
});
