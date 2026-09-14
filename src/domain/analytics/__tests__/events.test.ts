import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ageBucketOf,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENTS,
  validateAnalyticsEvent,
} from '../events';

/** Walks a Zod schema and returns every leaf type name (recursing into objects, arrays, unions, nullables). */
function leafTypes(schema: z.ZodType, out: string[] = []): string[] {
  const def = (schema as unknown as { def: { type: string } }).def;
  switch (def.type) {
    case 'object': {
      const shape = (schema as z.ZodObject).shape;
      for (const v of Object.values(shape)) leafTypes(v as z.ZodType, out);
      return out;
    }
    case 'nullable':
    case 'optional':
    case 'default':
      return leafTypes((schema as unknown as { unwrap(): z.ZodType }).unwrap(), out);
    case 'array':
      return leafTypes((schema as unknown as { element: z.ZodType }).element, out);
    case 'union':
      for (const o of (schema as z.ZodUnion).options) leafTypes(o as z.ZodType, out);
      return out;
    default:
      out.push(def.type);
      return out;
  }
}

describe('analytics allowlist (FR-28, §19)', () => {
  it('no event schema has a string leaf: journal text is not representable', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const leaves = leafTypes(ANALYTICS_EVENTS[name]);
      expect(leaves, name).not.toContain('string');
      expect(leaves, name).not.toContain('any');
      expect(leaves, name).not.toContain('unknown');
      expect(leaves, name).not.toContain('record');
      for (const t of leaves)
        expect(['enum', 'boolean', 'number', 'literal'], `${name}: ${t}`).toContain(t);
    }
  });

  it('every event is strict: a question or a note smuggled in as an extra key is rejected', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const valid = sampleFor(name);
      expect(validateAnalyticsEvent(name, valid).ok, name).toBe(true);
      expect(validateAnalyticsEvent(name, { ...valid, question: 'Will he call?' }).ok, name).toBe(
        false,
      );
      expect(
        validateAnalyticsEvent(name, { ...valid, user_notes: 'my private note' }).ok,
        name,
      ).toBe(false);
    }
    expect(validateAnalyticsEvent('not_an_event', {}).ok).toBe(false);
  });

  it('numbers are bounded so a counter cannot become a channel', () => {
    expect(validateAnalyticsEvent('journey_viewed', { members: 10 ** 9 }).ok).toBe(false);
    expect(validateAnalyticsEvent('journey_viewed', { members: -1 }).ok).toBe(false);
    expect(validateAnalyticsEvent('journey_viewed', { members: 1.5 }).ok).toBe(false);
  });

  it('age buckets are classes, not dates', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    expect(ageBucketOf('2026-09-14T09:00:00Z', now)).toBe('same_day');
    expect(ageBucketOf('2026-09-10T09:00:00Z', now)).toBe('week');
    expect(ageBucketOf('2026-08-20T09:00:00Z', now)).toBe('month');
    expect(ageBucketOf('2026-07-01T09:00:00Z', now)).toBe('quarter');
    expect(ageBucketOf('2025-01-01T09:00:00Z', now)).toBe('older');
  });
});

/** A valid props object for each event, built from the schema's own enums and types. */
function sampleFor(name: keyof typeof ANALYTICS_EVENTS): Record<string, unknown> {
  const shape = ANALYTICS_EVENTS[name].shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(shape)) {
    const def = (v as unknown as { def: { type: string; entries?: Record<string, string> } }).def;
    if (def.type === 'enum') out[k] = Object.values(def.entries ?? {})[0];
    else if (def.type === 'boolean') out[k] = true;
    else if (def.type === 'number') out[k] = 1;
    else if (def.type === 'nullable') out[k] = null;
    else throw new Error(`no sample for ${name}.${k}: ${def.type}`);
  }
  return out;
}
