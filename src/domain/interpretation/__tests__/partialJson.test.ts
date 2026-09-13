import { describe, expect, it } from 'vitest';
import { parseCompleteJson, parsePartialJson, partialInterpretation } from '../partialJson';

const FULL = {
  synthesis: 'One sentence, with a "quote" and an escape \\ here.',
  per_card: [
    { position_index: 0, text: 'First card text.', nuances: ['a nuance'] },
    { position_index: 1, text: 'Second card text.', nuances: [] },
  ],
  combined: 'Together they suggest…',
  reflective_prompts: ['What would change?', 'What stays?'],
};
const TEXT = JSON.stringify(FULL);

describe('partial JSON parsing while streaming', () => {
  it('parses the complete document exactly', () => {
    expect(parsePartialJson(TEXT)).toEqual(FULL);
    expect(parseCompleteJson('```json\n' + TEXT + '\n```')).toEqual(FULL);
  });

  it('every prefix parses to a subset, never throws, and strings grow monotonically', () => {
    let lastSynthesis = '';
    for (let i = 0; i <= TEXT.length; i++) {
      const p = partialInterpretation(TEXT.slice(0, i));
      if (p.synthesis !== undefined) {
        expect(p.synthesis.startsWith(lastSynthesis)).toBe(true);
        lastSynthesis = p.synthesis;
        expect(FULL.synthesis.startsWith(p.synthesis)).toBe(true);
      }
      for (const c of p.per_card ?? []) {
        if (c.position_index !== undefined) {
          expect(FULL.per_card[c.position_index]!.text.startsWith(c.text ?? '')).toBe(true);
        }
      }
    }
    expect(lastSynthesis).toBe(FULL.synthesis);
  });

  it('surfaces layers in order as they arrive', () => {
    const cut = TEXT.indexOf('"combined"');
    const p = partialInterpretation(TEXT.slice(0, cut));
    expect(p.synthesis).toBe(FULL.synthesis);
    expect(p.per_card).toHaveLength(2);
    expect(p.combined).toBeUndefined();
    const later = partialInterpretation(TEXT.slice(0, TEXT.indexOf('"reflective_prompts"') + 22));
    expect(later.combined).toBe(FULL.combined);
    expect(later.reflective_prompts ?? []).toHaveLength(0);
  });

  it('ignores a preamble before the object and returns {} before it starts', () => {
    expect(partialInterpretation('Here is the reading:\n')).toEqual({});
    expect(partialInterpretation('Sure! {"synthesis": "Hel')).toEqual({ synthesis: 'Hel' });
  });

  it('does not emit a number that may still be growing', () => {
    expect(parsePartialJson('{"per_card":[{"position_index":1')).toEqual({ per_card: [{}] });
    expect(parsePartialJson('{"per_card":[{"position_index":1,')).toEqual({
      per_card: [{ position_index: 1 }],
    });
  });
});
