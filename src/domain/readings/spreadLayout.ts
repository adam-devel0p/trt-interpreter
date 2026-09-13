/**
 * Custom spreads (FR-05): the user names positions; coordinates are auto-arranged in rows so
 * the layout editor needs no dragging. Output validates against `spreadLayoutSchema`.
 */
import { spreadLayoutSchema, type SpreadLayout } from '../decks/types';
import { CUSTOM_SPREAD_MAX_POSITIONS, CUSTOM_SPREAD_MIN_POSITIONS } from './thresholds';

const CARD_ASPECT = 0.6;
const MAX_PER_ROW = 3;

/** Rows of up to three, last row centred, equal gutters; canvas aspect follows the grid. */
export function autoLayout(count: number): SpreadLayout {
  if (
    !Number.isInteger(count) ||
    count < CUSTOM_SPREAD_MIN_POSITIONS ||
    count > CUSTOM_SPREAD_MAX_POSITIONS
  ) {
    throw new RangeError(
      `count must be ${CUSTOM_SPREAD_MIN_POSITIONS}–${CUSTOM_SPREAD_MAX_POSITIONS}`,
    );
  }
  const perRow = Math.min(count, MAX_PER_ROW);
  const rows = Math.ceil(count / perRow);
  const gutter = 0.06;
  const w = (1 - gutter * (perRow + 1)) / perRow;
  const rowHeightRel = w / CARD_ASPECT; // in canvas-width units
  const canvasHeight = rows * rowHeightRel + gutter * (rows + 1);
  const aspect = round(1 / canvasHeight);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = row === rows - 1 ? count - row * perRow : perRow;
    const col = i - row * perRow;
    const rowWidth = inRow * w + (inRow - 1) * gutter;
    const x0 = (1 - rowWidth) / 2;
    const x = x0 + col * (w + gutter) + w / 2;
    const yTop = gutter * (row + 1) + row * rowHeightRel;
    const y = (yTop + rowHeightRel / 2) / canvasHeight;
    slots.push({ index: i, x: round(x), y: round(y), w: round(w) });
  }
  return spreadLayoutSchema.parse({ aspect, slots });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** URL-safe slug from a spread name; empty input yields `spread`. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'spread';
}

/** Position key from a position name, unique within the spread. */
export function positionKey(name: string, index: number, taken: Set<string>): string {
  let base = slugify(name).replace(/-/g, '_');
  if (!/^[a-z]/.test(base)) base = `p_${base}`;
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  if (key === 'spread') key = `position_${index + 1}`;
  return key;
}
