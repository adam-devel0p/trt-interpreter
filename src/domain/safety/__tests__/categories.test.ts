import { describe, expect, it } from 'vitest';
import { SAFETY_COPY, safetyClassificationSchema, shouldSurface } from '../categories';
import { findRegisterViolations } from '@/domain/interpretation/register';

describe('safety categories (spec §10)', () => {
  it('surfaces self-harm and immediate safety at any severity, others from medium', () => {
    expect(shouldSurface({ category: 'self_harm', severity: 'low' })).toBe(true);
    expect(shouldSurface({ category: 'immediate_safety', severity: 'low' })).toBe(true);
    expect(shouldSurface({ category: 'medical', severity: 'low' })).toBe(false);
    expect(shouldSurface({ category: 'financial', severity: 'medium' })).toBe(true);
    expect(shouldSurface({ category: 'none', severity: 'high' })).toBe(false);
  });

  it('copy is calm, hedged and points somewhere real', () => {
    for (const c of Object.values(SAFETY_COPY)) {
      expect(findRegisterViolations(`${c.heading} ${c.body}`)).toEqual([]);
      expect(c.body).not.toMatch(/refuse|cannot read|will not/i);
    }
    expect(SAFETY_COPY.self_harm.resources.some((r) => r.contact.startsWith('http'))).toBe(true);
  });

  it('rejects unknown categories', () => {
    expect(
      safetyClassificationSchema.safeParse({ category: 'gossip', severity: 'low' }).success,
    ).toBe(false);
  });
});
