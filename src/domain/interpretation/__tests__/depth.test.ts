import { describe, expect, it } from 'vitest';
import { selectDepth } from '../depth';

describe('depth selection by profile (spec §9.3 rule 7)', () => {
  it('follows ai_explanation_depth for beginners and comfortable readers', () => {
    expect(selectDepth({ ai_explanation_depth: 'brief', experience_level: 'beginner' }).depth).toBe(
      'brief',
    );
    expect(selectDepth({ ai_explanation_depth: 'standard', experience_level: null }).depth).toBe(
      'standard',
    );
    expect(
      selectDepth({ ai_explanation_depth: 'deep', experience_level: 'comfortable' }).depth,
    ).toBe('deep');
  });

  it('experienced readers get one step shorter and folded layers', () => {
    const deep = selectDepth({ ai_explanation_depth: 'deep', experience_level: 'experienced' });
    expect(deep.depth).toBe('standard');
    expect(deep.collapsedByDefault).toBe(true);
    expect(
      selectDepth({ ai_explanation_depth: 'standard', experience_level: 'experienced' }).depth,
    ).toBe('brief');
    expect(
      selectDepth({ ai_explanation_depth: 'brief', experience_level: 'experienced' }).depth,
    ).toBe('brief');
  });

  it('token budgets grow with depth', () => {
    const b = selectDepth({ ai_explanation_depth: 'brief', experience_level: null }).maxTokens;
    const s = selectDepth({ ai_explanation_depth: 'standard', experience_level: null }).maxTokens;
    const d = selectDepth({ ai_explanation_depth: 'deep', experience_level: null }).maxTokens;
    expect(b).toBeLessThan(s);
    expect(s).toBeLessThan(d);
    expect(
      selectDepth({ ai_explanation_depth: 'standard', experience_level: null }).collapsedByDefault,
    ).toBe(false);
  });
});
