/**
 * Hedged-register scanner (spec §3.3, §9.3, DESIGN_SYSTEM copy rules). Interpretation is
 * reflection, never prediction: no percentages, no certainty about the future, no accuracy
 * claims, no commands from "the cards". Used at runtime as a validator (one repair) and by the
 * eval suite. Patterns are deliberately narrow — "will" alone would ban "free will".
 */

export interface RegisterViolation {
  pattern: string;
  match: string;
}

const BANNED: { pattern: string; re: RegExp }[] = [
  { pattern: 'percentage', re: /\b\d{1,3}(?:\.\d+)?\s?%/ },
  { pattern: 'percent', re: /\b\d{1,3}\s?percent\b/i },
  {
    pattern: 'will happen',
    re: /\bwill (?:definitely |certainly |surely )?(?:happen|come true|come to pass)\b/i,
  },
  {
    pattern: 'you will',
    re: /\byou (?:will|are going to) (?:get|find|lose|win|succeed|fail|meet|receive|be offered|be promoted|marry|break up|recover)\b/i,
  },
  { pattern: 'definitely', re: /\bdefinitely\b/i },
  { pattern: 'certainly', re: /\b(?:certainly|undoubtedly|without (?:a )?doubt)\b/i },
  { pattern: 'guaranteed', re: /\bguarantee[sd]?\b/i },
  {
    pattern: 'the cards say you must',
    re: /\bthe cards? (?:say|says|tell|tells|demand|demands)[^.]{0,40}\byou (?:must|have to|need to)\b/i,
  },
  { pattern: 'you must', re: /\byou must\b/i },
  { pattern: 'destined', re: /\b(?:destined|fated|it is written)\b/i },
  { pattern: 'accuracy claim', re: /\b(?:accurate|accuracy) (?:rate|of \d)/i },
  { pattern: 'prediction', re: /\b(?:I|this) predicts?\b/i },
];

/** Returns every banned phrase found in `text`; empty means the register is acceptable. */
export function findRegisterViolations(text: string): RegisterViolation[] {
  const found: RegisterViolation[] = [];
  for (const { pattern, re } of BANNED) {
    const m = re.exec(text);
    if (m) found.push({ pattern, match: m[0] });
  }
  return found;
}

/** Words that mark a hedged sentence; the eval reports their density, it never fails on it. */
export const HEDGES = [
  'suggests',
  'may',
  'might',
  'could',
  'one way to read',
  'perhaps',
  'seems',
  'invites',
  'points to',
  'hints',
];

export function hedgeCount(text: string): number {
  const lower = text.toLowerCase();
  return HEDGES.reduce((n, h) => n + (lower.match(new RegExp(`\\b${h}\\b`, 'g')) ?? []).length, 0);
}
