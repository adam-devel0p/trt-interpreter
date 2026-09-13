import { describe, expect, it } from 'vitest';
import { describeDeletion } from '../../../app/(app)/reading/[id]/controls';
import { previewText } from '@/ui/components/timeline-item';

describe('deletion copy names exactly what goes', () => {
  it('lists cards, notes, history and interpretations, and says it is final', () => {
    expect(describeDeletion({ cards: 3, hasNotes: true, interpretations: 2, revisions: 1 })).toBe(
      'This reading, its 3 cards, your notes, 1 earlier version of your words and 2 AI interpretations. It leaves your timeline now and is purged for good within minutes. This cannot be undone.',
    );
    expect(
      describeDeletion({ cards: 1, hasNotes: false, interpretations: 0, revisions: 0 }),
    ).toMatch(/^This reading, its 1 card\. It leaves/);
  });
});

describe('timeline preview', () => {
  it('collapses whitespace and truncates on a word with an ellipsis', () => {
    expect(previewText('  a \n b  ')).toBe('a b');
    const long = 'word '.repeat(60);
    const p = previewText(long);
    expect(p.length).toBeLessThanOrEqual(140);
    expect(p.endsWith('…')).toBe(true);
  });
});
