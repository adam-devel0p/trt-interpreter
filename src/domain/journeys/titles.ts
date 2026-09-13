/**
 * Deterministic placeholder titles. A journey is created by rule code before any model runs
 * (and for users without AI consent, that is its title for good): the shared entity's
 * label, else the shared themes, else the strongest theme. Plain, never a claim.
 */
export interface TitleInput {
  sharedEntityLabels: readonly string[];
  sharedThemeLabels: readonly string[];
  topThemeLabels: readonly string[];
}

export const JOURNEY_TITLE_MAX = 80;

export function placeholderTitle(input: TitleInput): string {
  const entity = input.sharedEntityLabels[0];
  if (entity) return clip(entity);
  const themes = (input.sharedThemeLabels.length ? input.sharedThemeLabels : input.topThemeLabels)
    .slice(0, 2)
    .filter(Boolean);
  if (themes.length === 2) return clip(`${themes[0]} and ${themes[1]!.toLowerCase()}`);
  if (themes.length === 1) return clip(themes[0]!);
  return 'Untitled journey';
}

export function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > JOURNEY_TITLE_MAX ? `${one.slice(0, JOURNEY_TITLE_MAX - 1).trimEnd()}…` : one;
}
