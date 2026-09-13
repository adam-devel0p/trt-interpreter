import { describe, expect, it } from 'vitest';
import { spreadLayoutSchema } from '@/domain/decks/types';
import { autoLayout, positionKey, slugify } from '../spreadLayout';

const CARD_ASPECT = 0.6;

describe('autoLayout', () => {
  it('produces a valid layout with every slot inside the canvas and no overlaps, for 1–10 cards', () => {
    for (let n = 1; n <= 10; n++) {
      const layout = autoLayout(n);
      expect(spreadLayoutSchema.safeParse(layout).success).toBe(true);
      expect(layout.slots).toHaveLength(n);
      const boxes = layout.slots.map((s) => {
        const h = (s.w * layout.aspect) / CARD_ASPECT;
        return { x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y - h / 2, y1: s.y + h / 2 };
      });
      for (const b of boxes) {
        expect(b.x0).toBeGreaterThanOrEqual(-0.001);
        expect(b.x1).toBeLessThanOrEqual(1.001);
        expect(b.y0).toBeGreaterThanOrEqual(-0.001);
        expect(b.y1).toBeLessThanOrEqual(1.001);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap =
            a.x0 < b.x1 - 0.001 &&
            b.x0 < a.x1 - 0.001 &&
            a.y0 < b.y1 - 0.001 &&
            b.y0 < a.y1 - 0.001;
          expect(overlap, `slots ${i} and ${j} overlap at n=${n}`).toBe(false);
        }
    }
  });

  it('centres a short last row and rejects out-of-range counts', () => {
    const four = autoLayout(4);
    expect(four.slots[3]!.x).toBeCloseTo(0.5, 2);
    expect(four.slots[0]!.y).toBeLessThan(four.slots[3]!.y);
    expect(() => autoLayout(0)).toThrow(RangeError);
    expect(() => autoLayout(11)).toThrow(RangeError);
    expect(() => autoLayout(2.5)).toThrow(RangeError);
  });
});

describe('slugify / positionKey', () => {
  it('makes URL-safe slugs and stable, unique position keys', () => {
    expect(slugify('My Week Ahead!')).toBe('my-week-ahead');
    expect(slugify('  Éclairé — soirée ')).toBe('eclaire-soiree');
    expect(slugify('???')).toBe('spread');
    const taken = new Set<string>();
    const k1 = positionKey('What I hold', 0, taken);
    taken.add(k1);
    const k2 = positionKey('What I hold', 1, taken);
    expect(k1).toBe('what_i_hold');
    expect(k2).toBe('what_i_hold_2');
    expect(positionKey('3rd thing', 2, taken)).toBe('p_3rd_thing');
    expect(positionKey('', 4, taken)).toBe('position_5');
  });
});
