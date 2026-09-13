/**
 * Mention text normalisation for alias matching (§7.1). The normalised form drops case,
 * diacritics, punctuation, possessive framing ("my", "our", "the") and a trailing possessive,
 * so "My Girlfriend", "my girlfriend’s" and "girlfriend" all key the same alias.
 */

const LEADING = /^(my|our|the|a|an|his|her|their)\s+/;

export function normalizeAlias(text: string): string {
  let s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (;;) {
    const next = s.replace(LEADING, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

const PRONOUNS = new Set([
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'you',
  'your',
  'yours',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'they',
  'them',
  'their',
  'theirs',
  'we',
  'us',
  'our',
  'ours',
  'it',
  'its',
  'this',
  'that',
  'someone',
  'somebody',
  'everyone',
  'anyone',
  'people',
  'things',
  'everything',
]);

/** Pronouns and empty referents are never candidates on their own (docs/ALGORITHMS.md §1). */
export function isPronoun(text: string): boolean {
  const n = normalizeAlias(text);
  return n === '' || PRONOUNS.has(n);
}

/**
 * Does the surface form look like a proper name (as opposed to a relational descriptor like
 * "my girlfriend" or "the agency")? Capitalised words that survive normalisation, not a
 * descriptor from the relation lexicon. A single initial ("M.") counts as a name.
 */
export function looksLikeName(text: string, isDescriptor: (n: string) => boolean): boolean {
  const n = normalizeAlias(text);
  if (!n || isDescriptor(n)) return false;
  const words = text
    .replace(/^(my|our|the|his|her|their)\s+/i, '')
    .trim()
    .split(/\s+/);
  return words.length > 0 && words.every((w) => /^\p{Lu}/u.test(w));
}
