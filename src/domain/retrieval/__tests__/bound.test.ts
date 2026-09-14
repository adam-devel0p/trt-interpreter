import { describe, expect, it } from 'vitest';
import { boundPackage, estimateTokens, PACKAGE_MAX_OBJECTS, PACKAGE_MAX_TOKENS } from '../bound';

describe('boundPackage', () => {
  const items = (n: number, tokens: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `o${i}`, tokens }));

  it('limits are 24 objects and 6000 tokens', () => {
    expect(PACKAGE_MAX_OBJECTS).toBe(24);
    expect(PACKAGE_MAX_TOKENS).toBe(6000);
  });

  it('keeps a strict rank prefix of whole objects under both caps', () => {
    const r = boundPackage(items(40, 100));
    expect(r.kept).toHaveLength(24);
    expect(r.dropped).toHaveLength(16);
    expect(r.kept.map((k) => k.id)).toEqual(items(24, 100).map((k) => k.id));
    expect(r.tokens).toBe(2400);
  });

  it('drops the lowest-ranked whole objects when tokens run out — never truncates, never reorders', () => {
    const list = [
      { id: 'a', tokens: 3000 },
      { id: 'b', tokens: 2500 },
      { id: 'c', tokens: 1000 }, // does not fit: 6500 > 6000
      { id: 'd', tokens: 100 }, // would fit, but is lower-ranked than c → dropped too
    ];
    const r = boundPackage(list);
    expect(r.kept.map((k) => k.id)).toEqual(['a', 'b']);
    expect(r.dropped.map((k) => k.id)).toEqual(['c', 'd']);
    expect(r.tokens).toBe(5500);
  });

  it('a single object over the cap is dropped, not cut', () => {
    const r = boundPackage([{ id: 'huge', tokens: 9000 }]);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toHaveLength(1);
  });

  it('estimates four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
